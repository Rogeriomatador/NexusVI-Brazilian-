# SPDX-License-Identifier: GPL-3.0-or-later
# Collect process metrics only from the fixed, original synthetic child below.
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
    $identity = [ordered]@{
        collector_sha256 = (Get-FileHash -LiteralPath $PSCommandPath -Algorithm SHA256).Hash.ToLowerInvariant()
        git_revision = $null
        tracked_changes = $null
    }
    try {
        $git = Get-Command git -CommandType Application -ErrorAction Stop
        $root = Split-Path -Parent $PSScriptRoot
        $rev = & $git.Source -C $root rev-parse --verify HEAD 2>$null
        if ($LASTEXITCODE -eq 0 -and "$rev" -match '^[0-9a-f]{40}$') {
            $identity.git_revision = "$rev"
            $changes = @(& $git.Source -C $root status --porcelain --untracked-files=no 2>$null)
            if ($LASTEXITCODE -eq 0) { $identity.tracked_changes = ($changes.Count -gt 0) }
        }
    } catch {
        # A standalone download can still be identified by its SHA-256.
    }
    return $identity
}

$hardware = Get-Hardware
$identity = Get-SourceIdentity

# The child command is fixed except for a validated integer duration.
# It does not execute or attach to any user-supplied application.
$worker = @'
$ErrorActionPreference = 'Stop'
$buffer = New-Object byte[] 65536
$sha = [System.Security.Cryptography.SHA256]::Create()
$timer = [Diagnostics.Stopwatch]::StartNew()
try {
    while ($timer.Elapsed.TotalSeconds -lt __SECONDS__) {
        $digest = $sha.ComputeHash($buffer)
        $buffer[0] = $digest[0]
    }
} finally {
    $sha.Dispose()
}
'@
$worker = $worker.Replace('__SECONDS__', [string]$Seconds)
$encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($worker))
$hostExe = (Get-Process -Id $PID -ErrorAction Stop).Path
$process = $null
$rows = [Collections.Generic.List[object]]::new()
$watch = [Diagnostics.Stopwatch]::StartNew()
$startedUtc = [DateTime]::UtcNow.ToString('o')
try {
    $process = Start-Process -FilePath $hostExe -ArgumentList @(
        '-NoProfile', '-NonInteractive', '-EncodedCommand', $encoded
    ) -NoNewWindow -PassThru -ErrorAction Stop
    $previous = $null
    while ($true) {
        if ($watch.Elapsed.TotalSeconds -gt ($Seconds + 15)) {
            throw 'Synthetic worker exceeded its time budget.'
        }
        $process.Refresh()
        if ($process.HasExited) { break }
        try {
            $cpuMs = $process.TotalProcessorTime.TotalMilliseconds
            $working = [int64]$process.WorkingSet64
            $private = [int64]$process.PrivateMemorySize64
        } catch {
            $process.Refresh()
            if ($process.HasExited) { break }
            throw
        }
        $elapsed = $watch.Elapsed.TotalMilliseconds
        $corePercent = $null
        $hostPercent = $null
        if ($null -ne $previous) {
            $dt = $elapsed - $previous.elapsed_ms
            $dcpu = $cpuMs - $previous.cpu_total_ms
            if ($dt -gt 0 -and $dcpu -ge 0) {
                $corePercent = 100.0 * $dcpu / $dt
                $hostPercent = $corePercent / $hardware.logical_processors
            }
        }
        $row = [pscustomobject][ordered]@{
            elapsed_ms = $elapsed
            cpu_total_ms = $cpuMs
            cpu_one_core_equivalent_pct = $corePercent
            cpu_host_logical_capacity_pct = $hostPercent
            working_set_bytes = $working
            private_bytes = $private
        }
        $rows.Add($row)
        $previous = $row
        Start-Sleep -Milliseconds $SampleMs
    }
    $process.WaitForExit()
    if ($process.ExitCode -ne 0) { throw 'Synthetic worker failed.' }
    if ($rows.Count -lt 2) { throw 'Insufficient process samples.' }
    $last = $rows[$rows.Count - 1]
    if ($last.cpu_total_ms -le 0) { throw 'No measured CPU work.' }
    $report = [ordered]@{
        schema_version = 1
        scope = 'independent_synthetic_cpu_only'
        started_utc = $startedUtc
        source = $identity
        hardware = $hardware
        workload = [ordered]@{
            id = 'sha256_chain_64k_v1'
            requested_seconds = $Seconds
            sample_interval_ms = $SampleMs
            exit_code = $process.ExitCode
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
    if ($null -ne $process) {
        $process.Refresh()
        if (-not $process.HasExited) {
            $process.Kill()
            [void]$process.WaitForExit(5000)
        }
        $process.Dispose()
    }
}
