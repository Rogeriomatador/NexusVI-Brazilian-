# SPDX-License-Identifier: GPL-3.0-or-later
# Collect metrics during the fixed, original in-process synthetic CPU workload.
[CmdletBinding()]
param(
    [ValidateRange(5, 120)][int]$Seconds = 15,
    [ValidateRange(100, 1000)][int]$SampleMs = 250
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT) {
    throw 'This collector requires Windows.'
}

function Get-Hardware {
    $result = [ordered]@{
        os_version = [Environment]::OSVersion.VersionString
        logical_processors = [Environment]::ProcessorCount
        cpu_models = $null
        physical_ram_bytes = $null
        graphics_adapters = $null
        cim_status = 'unavailable'
    }
    try {
        $result.cpu_models = @(Get-CimInstance Win32_Processor -ErrorAction Stop |
            ForEach-Object { [string]$_.Name })
        $result.physical_ram_bytes = [uint64](Get-CimInstance Win32_ComputerSystem -ErrorAction Stop).TotalPhysicalMemory
        $result.graphics_adapters = @(Get-CimInstance Win32_VideoController -ErrorAction Stop |
            ForEach-Object {
                [ordered]@{ name = [string]$_.Name; driver_version = [string]$_.DriverVersion }
            })
        $result.cim_status = 'available'
    } catch {
        # Do not expose host names, serial numbers, paths or exception text.
        $result.cim_status = 'partial_or_unavailable'
    }
    return $result
}

function Get-SourceIdentity {
    param([Parameter(Mandatory)][string]$ScriptPath)
    $identity = [ordered]@{
        collector_sha256 = (Get-FileHash -LiteralPath $ScriptPath -Algorithm SHA256).Hash.ToLowerInvariant()
        git_revision = $null
        tracked_changes = $null
        git_status = 'standalone_or_unavailable'
    }
    if ((Split-Path -Leaf (Split-Path -Parent $ScriptPath)) -ne 'scripts') {
        return $identity
    }
    try {
        # Multiple Git installations can return multiple ApplicationInfo objects.
        $git = Get-Command git -CommandType Application -ErrorAction Stop |
            Select-Object -First 1
        $gitExe = [string]$git.Source
        $root = Split-Path -Parent (Split-Path -Parent $ScriptPath)
        $relative = 'scripts/nexusvi_hardware_control.ps1'
        $expectedPath = Join-Path $root $relative
        if (-not [string]::Equals([IO.Path]::GetFullPath($expectedPath),
                [IO.Path]::GetFullPath($ScriptPath), [StringComparison]::OrdinalIgnoreCase)) {
            return $identity
        }
        $tracked = @(& $gitExe -C $root ls-files --error-unmatch -- $relative 2>$null)
        if ($LASTEXITCODE -ne 0 -or $tracked.Count -ne 1 -or $tracked[0] -ne $relative) {
            return $identity
        }
        $rev = @(& $gitExe -C $root rev-parse --verify HEAD 2>$null)
        if ($LASTEXITCODE -eq 0 -and $rev.Count -eq 1 -and $rev[0] -match '^[0-9a-f]{40}$') {
            $identity.git_revision = [string]$rev[0]
            $identity.git_status = 'revision_observed'
            $changes = @(& $gitExe -C $root status --porcelain --untracked-files=no 2>$null)
            if ($LASTEXITCODE -eq 0) { $identity.tracked_changes = ($changes.Count -gt 0) }
        }
    } catch {
        $identity.git_status = 'git_query_failed'
    }
    return $identity
}

$hardware = Get-Hardware
$identity = Get-SourceIdentity -ScriptPath $PSCommandPath

# The fixed CPU workload runs in this PowerShell process. There is no
# subprocess, encoded command, external executable or arbitrary process target.
# CPU time and memory include the host and measurement overhead.
$process = [Diagnostics.Process]::GetCurrentProcess()
$rows = [Collections.Generic.List[object]]::new()
$buffer = New-Object byte[] 65536
$sha = $null
$watch = [Diagnostics.Stopwatch]::new()
$startedUtc = [DateTime]::UtcNow.ToString('o')
$hashes = [long]0

function Get-ControlSample {
    param(
        [Diagnostics.Process]$Process,
        [Diagnostics.Stopwatch]$Watch,
        [double]$BaselineCpuMs,
        [int]$LogicalProcessors,
        $Previous,
        [long]$Hashes
    )
    $Process.Refresh()
    $cpuMs = $Process.TotalProcessorTime.TotalMilliseconds - $BaselineCpuMs
    $elapsed = $Watch.Elapsed.TotalMilliseconds
    $corePercent = $null
    $hostPercent = $null
    if ($null -ne $Previous) {
        $dt = $elapsed - $Previous.elapsed_ms
        $dcpu = $cpuMs - $Previous.cpu_total_ms
        if ($dt -gt 0 -and $dcpu -ge 0) {
            $corePercent = 100.0 * $dcpu / $dt
            $hostPercent = $corePercent / $LogicalProcessors
        }
    }
    [pscustomobject][ordered]@{
        elapsed_ms = $elapsed
        cpu_total_ms = $cpuMs
        cpu_one_core_equivalent_pct = $corePercent
        cpu_host_logical_capacity_pct = $hostPercent
        working_set_bytes = [int64]$Process.WorkingSet64
        private_bytes = [int64]$Process.PrivateMemorySize64
        completed_hashes = $Hashes
    }
}

try {
    $sha = [System.Security.Cryptography.SHA256]::Create()
    if ($null -eq $sha) { throw 'SHA-256 provider unavailable.' }
    $process.Refresh()
    $baseline = $process.TotalProcessorTime.TotalMilliseconds
    $watch.Start()
    $previous = Get-ControlSample -Process $process -Watch $watch -BaselineCpuMs $baseline -LogicalProcessors $hardware.logical_processors -Previous $null -Hashes 0
    $rows.Add($previous)
    $nextSample = [double]$SampleMs
    while ($watch.Elapsed.TotalSeconds -lt $Seconds) {
        $digest = $sha.ComputeHash($buffer)
        $buffer[0] = $digest[0]
        $hashes++
        if ($watch.Elapsed.TotalMilliseconds -ge $nextSample) {
            $row = Get-ControlSample -Process $process -Watch $watch -BaselineCpuMs $baseline -LogicalProcessors $hardware.logical_processors -Previous $previous -Hashes $hashes
            $rows.Add($row)
            $previous = $row
            $nextSample = $row.elapsed_ms + $SampleMs
        }
    }
    $last = Get-ControlSample -Process $process -Watch $watch -BaselineCpuMs $baseline -LogicalProcessors $hardware.logical_processors -Previous $previous -Hashes $hashes
    $rows.Add($last)
    $watch.Stop()
    if ($rows.Count -lt 2 -or $last.cpu_total_ms -le 0 -or $hashes -le 0) {
        throw 'Insufficient measured CPU work.'
    }
    $report = [ordered]@{
        schema_version = 2
        scope = 'independent_synthetic_cpu_only'
        started_utc = $startedUtc
        source = $identity
        hardware = $hardware
        workload = [ordered]@{
            id = 'sha256_chain_64k_in_process_v2'
            measurement_mode = 'current_powershell_process_including_host_overhead'
            requested_seconds = $Seconds
            sample_interval_ms = $SampleMs
            completed = $true
            completed_hashes = $hashes
            measured_elapsed_ms = $last.elapsed_ms
        }
        metrics = [ordered]@{
            sample_count = $rows.Count
            observed_cpu_total_ms = $last.cpu_total_ms
            peak_sampled_working_set_bytes = ($rows | Measure-Object working_set_bytes -Maximum).Maximum
            peak_sampled_private_bytes = ($rows | Measure-Object private_bytes -Maximum).Maximum
            fps = $null
            vram_bytes = $null
            gpu_utilization_pct = $null
            gpu_temperature_c = $null
        }
        unavailable_metrics_reason = 'No GPU rendering or GPU telemetry is performed by this CPU control.'
        samples = $rows.ToArray()
    }
    $report | ConvertTo-Json -Depth 8
} finally {
    $watch.Stop()
    if ($null -ne $sha) { $sha.Dispose() }
    $process.Dispose()
}
