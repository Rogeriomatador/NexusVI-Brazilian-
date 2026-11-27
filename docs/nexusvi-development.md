# NexusVI development charter

## Provenance

This line starts at Belobug/VIctory-Belobug-AMD, revision
`4eb6cfdf9e61cb112f1f811344ec0dd309eddd6c`, with original history and
GPL-3.0-or-later licensing retained. See LICENSE and docs/asset-policy.md.
The prior XCL-based project is separate (GPL-2.0-only). Do not import its
source code, patches, or linked components here. Independently implement
general engineering ideas when appropriate, documenting their provenance.

## First milestone: reproducible baseline

Use only original synthetic workloads or software explicitly authorized for
testing. Record the exact revision, OS, CPU, GPU, driver, build mode, and
workload identity. Distinguish real hardware from software rendering and
tests that skip unsupported capabilities. Report failures and skipped tests;
do not infer full coverage from a successful exit code.

For timing comparisons use identical input and settings, multiple repetitions,
and report the median, p95 and sample count. Keep raw measurements outside the
repository if they contain private or proprietary data. Do not publish inherited
upstream measurements as our own.

## Branch discipline

Preserve upstream branches and notices. Use nexusvi/* development branches,
small reviewable commits, and independent tests. No automated merge or
destructive history edits. Do not rename internal crate identifiers before
reviewing dependency and packaging effects. No proprietary content, leaked
material, confidential SDKs or DRM circumvention.

## First independent tool

`scripts/nexusvi_sample_stats.rs` summarizes positive finite timing samples
in milliseconds from standard input. It is standalone, has no dependencies,
and does not load any external software or game. Its unit tests can be run
with `rustc --edition=2024 --test scripts/nexusvi_sample_stats.rs -o sample_stats_tests`.
Build the CLI with `rustc --edition=2024 scripts/nexusvi_sample_stats.rs -o sample_stats`.
Supply one or more whitespace-separated numeric samples via stdin.
P95 and P99 use the nearest-rank definition; the median uses a numerical midpoint
for an even number of samples. The output includes min/max and sample count.
Input is limited to 8 MiB. The independent workflow runs only this standalone
program's tests, not the inherited runtime or any proprietary workload. These statistics alone do not establish
a performance improvement.

## Next independent work

Audit the existing synthetic test inventory, establish a local baseline,
and select general-purpose correctness work based on measured evidence.

## Matched benchmark comparison

The standalone GPL-3.0-or-later tool `scripts/nexusvi_compare.rs` compares two
files of timings from original synthetic workloads. Compile it with
`rustc +stable --edition=2024 scripts/nexusvi_compare.rs -o nexusvi_compare`.
Each input has three header lines: `revision=<40 hex digits>`,
`context=<identical workload, settings, hardware, OS, driver, toolchain description>`,
and `pair_id,ms`. Each following line contains a unique unsigned pair ID and
one positive finite timing. Use at least 20 matched pairs from alternating
runs, with identical workload and settings. Input files are limited to 8 MiB.
The tool rejects differing declared contexts, duplicate or unmatched IDs,
identical revisions and nonrepresentable timing ratios. It reports candidate
/ baseline median, p95 and median paired ratios, plus slower-pair counts.
Exit 2 flags a descriptive regression (median or paired median > 1.05, or
p95 > 1.10); exit 1 means invalid input; exit 0 means within those thresholds.
Neither the screen nor identical context strings establish statistical
significance or independently verify the environment. Do not infer GPU coverage.

## Synthetic CPU benchmark control

The independent `scripts/nexusvi_synthetic.rs` compares a simple sixteen-pass
histogram reference with a single-pass histogram using deterministic generated
integers. This demonstrates the measurement pipeline, not the performance of
VIctory or any compatibility runtime. Compile and run:

```sh
rustc +stable --edition=2024 -O scripts/nexusvi_synthetic.rs -o nexusvi_synthetic
./nexusvi_synthetic 65536 20 42
```

Arguments are item count, pair count and unsigned seed. The generator uses
fixed wrapping arithmetic; the two algorithms see identical inputs per pair,
with alternating order and an unrecorded warmup. Data generation and correctness
checks are outside the timed regions. Every histogram is compared exactly.
The work budget bounds input memory and execution effort. The tool emits raw
nanosecond pairs only after all checks pass. A zero duration is an error.
CI runs the six unit tests and an optimized 20-pair smoke run; the smoke tests
report structure, not speed thresholds. Compiler optimizations, host scheduling,
CPU cache effects and timer resolution can affect the timing. This standalone
report compares two algorithms, not two Git revisions; it is intentionally not
accepted directly as input to the revision comparator.

## Synthetic report verification

The independent `scripts/nexusvi_synthetic_report.rs` consumes the raw CPU
control report from stdin. It validates workload/version, declared counts,
work budget, seed, exact sequential pair IDs, positive unsigned durations,
and absence of trailing rows, within a 128 KiB input limit. It reports the
ratio of medians, median paired speedup and results grouped by which algorithm
ran first, plus counts of wins, ties and losses. These are descriptive measures,
not statistical significance or proof of order effects. The reader validates
structure, not provenance or the truth of self-reported timings. CI checks
both a real generated report and deliberate truncation. Build with
`rustc +stable --edition=2024 -O scripts/nexusvi_synthetic_report.rs -o nexusvi_report`.

## Independent range allocation model

The standalone `scripts/nexusvi_range_arena.rs` models bounded logical byte
ranges without mapping real memory or interacting with the inherited runtime.
It implements aligned first-fit allocation, splitting free ranges, two-sided
coalescing, and serial-tagged handles to reject stale frees within one arena.
Handles are arena-local; they are not authentication tokens and must not be
transferred between arenas. The model is single-threaded, has a linear search
across free ranges, and does not claim runtime or GPU performance improvements.
Seven tests include an exhaustive bounded bitmap comparison and a deterministic
20,000-operation sequence. CI compiles the independent model and executes a
small reclamation demonstration. Build with
`rustc +stable --edition=2024 -O scripts/nexusvi_range_arena.rs -o nexusvi_arena`.

## Windows hardware control report

The independent PowerShell script `scripts/nexusvi_hardware_control.ps1`
runs its own fixed SHA-256 chain CPU workload in the current PowerShell process.
It does not launch a subprocess or attach to another executable. Schema v2
replaces the failed subprocess-based v1; timing and memory measurements from
these modes are not comparable. CPU time is relative to the initial process
CPU time. Working set and private bytes include the host and collector overhead.
The report includes completed hash count, observed duration, sample count,
source SHA-256 and (for a tracked checkout) Git revision. CIM metadata is
best effort. Sampled memory peaks are lower bounds and CPU interval estimates
may overshoot due to timer granularity. FPS, VRAM, GPU load and temperature
remain null. No serial numbers, usernames, hostnames or automatic uploads
are included. Review the report before sharing it.

Run in a fresh Windows PowerShell session with normal local script permissions:

```powershell
& ./scripts/nexusvi_hardware_control.ps1 -Seconds 15 -SampleMs 250 |
    Set-Content -Encoding utf8 "$env:TEMP/NexusVI-hardware-report.json"
```

A standalone download reports a null Git revision and its actual script hash.
CI checks both a tracked checkout and a standalone Windows PowerShell 5.1 copy.
The workload evaluates only the independent CPU measurement pipeline.

## Independent browser graphics control (experimental)

Open `scripts/NexusVI-Graphics-Control.html` locally in a WebGL 2-capable
browser with hardware acceleration. This original procedural fullscreen
shader uses no game files, external assets, network requests or inherited
runtime code. Select a fixed internal resolution, keep the tab visible,
and run a 2-second warmup and 15-second measurement. Save the JSON locally.
The report includes raw requestAnimationFrame intervals, descriptive frame
statistics, renderer strings and optional disjoint timer query measurements.
RAF cadence is not direct display-present FPS and is normally refresh-limited.
Renderer strings are not independent proof of physical GPU use. Timer queries
may be unsupported, disjoint or time out; such results are explicitly marked.
VRAM usage, GPU load and temperature are unavailable. Stop, hidden-tab and
context-loss events invalidate the report. No automatic uploads occur.

Validation at introduction: JavaScript syntax and six mocked state-machine
scenarios passed locally. Actual WebGL 2 context creation was unavailable in
the test environment; rendering and GPU timing remain unverified. This control
is not a compatibility or game performance benchmark.

## Graphics control V2 (independent experimental workloads)

Open `scripts/NexusVI-Graphics-Control-V2.html` locally. Three original
procedural scenarios exercise fragment arithmetic (64 iterations), 4096
instanced cubes, and 8192 instanced cubes with an additional alpha-blended
pass. Select 720p, 1080p, 1440p or 4K. Each scenario warms for two seconds
and records eight seconds of requestAnimationFrame intervals, optional GPU
timer queries (24 outstanding maximum), coverage and per-scenario statistics.
Disjoint results are discarded; timed-out queries are labeled partial.
A hidden tab, cancellation, invalid interval, WebGL error or lost context
invalidates the report. No network requests or external assets. No shadows,
texture stress, real GPU load/temperature/VRAM telemetry or presentation FPS.
The workload is unrelated to the inherited runtime. Hardware execution and
shader compilation have not been verified at introduction; the JS source
passes a syntax check only. Keep tests short and supervised.

## Independent graphics report verification

The dependency-free Node.js tool `scripts/nexusvi_graphics_verify.js` checks
schema v2 report identity, exact scenario definitions/order, resolution,
measurement duration, raw frame and GPU arrays, independently recomputed
summary statistics, cadence, query counts, coverage and timer status.
Input is bounded to 4 MiB and 10,000 samples per array. It rejects invalid
or inconsistent reports with exit code 1; successful verification returns
structured JSON. This is not attestation, signature verification or proof
that a physical GPU executed the workload. Duplicate JSON member detection
is not implemented. No report is automatically uploaded.

```sh
node scripts/nexusvi_graphics_verify.js --self-test
node scripts/nexusvi_graphics_verify.js report.json
```

26 deterministic synthetic fixture cases cover accepted complete, unsupported,
disjoint and partial states and invalid summaries, metadata and samples.
CI exercises the CLI on Windows and Linux. Fixtures contain invented timings
for testing arithmetic only, not benchmark evidence.

## Independent logical fragmentation experiment

Run `node scripts/nexusvi_fragmentation.js` with Node.js 22 or compatible.
An 8192-byte logical arena replays nine deterministic traces: three size/lifetime
profiles, three seeds and 2000 requests per trace. Both policies receive the
same request IDs, alignment, size and expiration times, regardless of earlier
allocation failures. First-fit chooses the first suitable interval; best-fit
minimizes total unused bytes within a suitable interval, breaking ties by
address. A separate byte-occupancy oracle verifies every placement, partition,
alignment, accounting and complete final reclamation. Failure categories
are insufficient total bytes, insufficient contiguous bytes, or alignment.
Mean external fragmentation is the average per-request value of
1 - largest_free / total_free (zero if no bytes are free). Range probes count
search iterations, not runtime or CPU cycles. Different accepted lifetimes
can change occupancy, so fragmentation alone is not a superiority criterion.

Observed local execution, Node.js v22.16.0, 2026-11-27:

| Metric | First-fit | Best-fit |
|---|---:|---:|
| Requests | 18000 | 18000 |
| Accepted | 15901 | 15937 |
| Failed | 2099 | 2063 |
| Contiguous-space failures | 1996 | 1839 |
| Alignment failures | 75 | 87 |
| Insufficient-total failures | 28 | 137 |
| Accepted bytes (cumulative) | 2134564 | 2169688 |
| Mean external fragmentation | 59.1989% | 55.1469% |
| Range probes | 285080 | 532223 |
| Full reclamation | 9/9 | 9/9 |

First-fit accepted 5118 vs 5078 mixed-profile requests; best-fit accepted
4859 vs 4783 large-profile requests. Both accepted all 6000 small requests.
Neither universally dominates. No physical memory, GPU or inherited runtime
performance is measured. CI repeats the experiment independently.
