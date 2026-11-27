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
launches only its own fixed SHA-256 chain CPU workload and records sampled
process CPU time, working set and private bytes. It cannot select or attach
to another executable. Hardware metadata uses best-effort CIM inventory,
including GPU model and driver, not GPU measurements. The source identity
contains the script SHA-256 and, when available, Git HEAD and tracked-change
status; untracked changes are not checked. CPU percentages are interval
estimates and can overshoot due to sampling or CPU timer granularity. Memory
peaks are sampled lower bounds; observed CPU time can omit the final interval.
FPS, VRAM, GPU load and temperature are explicitly null, not zero.
No serial numbers, usernames, hostnames or automatic uploads are included.
Review the JSON before sharing it; hardware models and driver details are
included. CI validates the report on its Windows runner, not a physical GPU.

Run from a Windows PowerShell session with normal local script permissions:

```powershell
& ./scripts/nexusvi_hardware_control.ps1 -Seconds 15 -SampleMs 250 |
    Set-Content -Encoding utf8 "$env:TEMP/NexusVI-hardware-report.json"
```

The report lives outside the repository. Its purpose is to test the independent
measurement pipeline, not to evaluate a game or the inherited runtime.
