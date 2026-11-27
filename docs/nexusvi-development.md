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
The p95 uses the nearest-rank definition; the median averages the two middle
values for an even number of samples. These statistics alone do not establish
a performance improvement.

## Next independent work

Audit the existing synthetic test inventory, establish a local baseline,
and select general-purpose correctness work based on measured evidence.
