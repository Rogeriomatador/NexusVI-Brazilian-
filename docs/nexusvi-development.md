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
