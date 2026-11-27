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

## Bounded-candidate hybrid allocation

A third policy, hybrid4, selects the smallest leftover among the first four
eligible ranges (ties by address); this is a cap on suitable candidates,
not a hard cap on total probes. Exhaustion still scans all ranges. The same
nine traces and independent byte-occupancy oracle are used for all three
policies. Two additional crafted cases exercise the fifth eligible range
and skipping non-fitting ranges. Baseline outcomes were reproduced exactly
for accepted counts and range probes. The following results were measured
by executing the JavaScript core in a local JS isolate with equivalent strict
assertions; the native Node CLI is scheduled for cross-platform CI.

| Policy | Accepted | Failed | Mean fragmentation | Probes | Full reclamation |
|---|---:|---:|---:|---:|---:|
| first | 15901 | 2099 | 59.1989% | 285080 | 9/9 |
| best | 15937 | 2063 | 55.1469% | 532223 | 9/9 |
| hybrid4 | 15955 | 2045 | 54.8005% | 453160 | 9/9 |

| Policy | Small | Mixed | Large |
|---|---:|---:|---:|
| first | 6000 | 5118 | 4783 |
| best | 6000 | 5078 | 4859 |
| hybrid4 | 6000 | 5093 | 4862 |

The experiment comprises 54,000 allocation requests in total, 18,000 per
policy. These are deterministic logical results, not runtime measurements.
No universal policy recommendation or inherited runtime change is implied.

## Expanded held-out allocation experiment

The original nine 2000-request traces remain unchanged. A separate holdout
uses 800 requests per trace, seeds 271828 and 314159, three existing profiles
and capacities 4096 and 8192 bytes (12 traces, 9600 requests per policy).
Compare first-fit, best-fit, and limits of 2, 4, 8 and 16 eligible candidates.
These are candidate limits, not probe limits. A crafted 17-gap test verifies
all limits and address selection. The independent bitmap oracle still checks
every placement, accounting and reclamation. The bitmap free count uses a
loop rather than a callback reduction to reduce test overhead.

Observed in JS isolate, 2026-11-27, with equivalent strict assertions:

| Policy | Accepted | Failed | Probes | Mean fragmentation | Reclaimed |
|---|---:|---:|---:|---:|---:|
| first | 7611 | 1989 | 142724 | 64.9187% | 12/12 |
| best | 7639 | 1961 | 244749 | 60.4500% | 12/12 |
| hybrid2 | 7647 | 1953 | 179225 | 61.4333% | 12/12 |
| hybrid4 | 7646 | 1954 | 216549 | 60.2784% | 12/12 |
| hybrid8 | 7639 | 1961 | 238485 | 60.3236% | 12/12 |
| hybrid16 | 7638 | 1962 | 244071 | 59.9886% | 12/12 |

| Policy | Accepted at 4096 bytes | Accepted at 8192 bytes |
|---|---:|---:|
| first | 3371 | 4240 |
| best | 3399 | 4240 |
| hybrid2 | 3398 | 4249 |
| hybrid4 | 3380 | 4266 |
| hybrid8 | 3415 | 4224 |
| hybrid16 | 3398 | 4240 |

Run `node scripts/nexusvi_fragmentation.js --holdout`. The new traces are
held out relative to the prior Hybrid4 experiment but reuse its workload
families. This is not a comprehensive workload distribution or a timing
benchmark; selecting a policy from these results would require additional
independent validation. CI reruns original and held-out experiments.

## Indexed logical first-fit experiment

A dense max-length segment tree indexed by free interval start prunes
subtrees that cannot hold the requested length. Alignment is checked at
leaves; left-first traversal preserves exact first-fit semantics. Maps by
start/end support two-sided merging. The bitmap oracle checks all placements,
free intervals, root maximum, accounting and final recovery. Four crafted
checks cover alignment, merge, non-power-of-two capacity and fragmentation.
The 12 previous held-out traces are reused (9600 requests). Results observed
in a JS isolate with equivalent strict assertions, not native Node timing:

| Metric | Value |
|---|---:|
| accepted | 7611 |
| failed | 1989 |
| linearProbes | 142724 |
| indexVisits | 175479 |
| indexLeaves | 9164 |
| updateWrites | 547114 |

All 12 traces fully reclaimed their logical capacity. Accepted counts and
linear probe counts match the previous First-fit baseline. Tree visits,
leaf checks and update writes are different operations; fewer leaf checks
alone do not imply speedup. The dense index alone takes 32768 bytes for a
4096-byte arena and 65536 bytes for an 8192-byte arena, excluding maps.
This is an intentionally bounded correctness experiment, not a production
allocator or a recommendation to integrate into the inherited runtime.
Run `node scripts/nexusvi_indexed_arena.js`; native CI repeats the checks.

## Sparse logical AVL first-fit experiment

An AVL tree stores exactly one node per free interval, augmented with subtree
maximum raw free length. Address-ordered traversal and explicit alignment
checks preserve first-fit choices. An end-address map supports coalescing.
Every allocation is compared with an independent occupancy reference; each
step validates exact free intervals, AVL balance, heights, maxima and live
byte accounting. Six crafted cases include monotonic freeing in both orders.
Observed JS-isolate execution (equivalent strict assertions), same 12 traces
and 9600 requests as dense index experiment:

| Metric | Value |
|---|---:|
| accepted | 7611 |
| failed | 1989 |
| linearProbes | 142724 |
| indexVisits | 56568 |
| candidates | 9164 |
| mutationVisits | 327088 |
| recalculations | 196688 |
| rotations | 15620 |

| Capacity | Peak AVL nodes | Peak height |
|---|---:|---:|
| 4096 | 53 | 7 |
| 8192 | 61 | 7 |

All 12 traces reclaimed their entire logical arena. Search visits count
non-null AVL nodes; mutation visits include insertion/deletion traversal,
successor traversal and lookup. Recalculations count height/max refreshes;
rotations are separately recorded, not independent of recalculations. These
counts are not directly interchangeable with dense tree writes or CPU time.
Node counts describe structural size, not measured JavaScript heap bytes.
No GPU, physical memory or inherited runtime is measured. Native CI runs
`node scripts/nexusvi_sparse_arena.js`.

## Controlled logical arena timing

The three existing instrumented First-fit implementations are exported for
an independent timing harness. The occupancy oracle precomputes placements
and successful-request release schedules before timing. Each sample replays
all 12 held-out traces (9600 requests, 7611 accepted); exact placements,
release success and final free state are checked after stopping the clock.
Three warmup rounds and 18 measured rounds balance all six execution orders
three times. Timing uses Node's monotonic hrtime, including construction,
event dispatch, allocations/releases, internal assertions/counters, result
writes and final releases; excluding the external oracle and verification.
Raw per-round nanoseconds and median/P95/min/max are emitted. This compares
instrumented implementations, not pure search latency or production code.
GC, JIT, host scheduling and platform differences can affect measurements;
no automatic speed threshold or cross-platform pooled result is used.

Five harness checks passed in a JS isolate (including a deliberately wrong
placement and nonadvancing clock). All three implementations also reproduced
7611 accepted requests in six balanced full-suite rounds using a synthetic
clock for verification only. No measured timings are claimed from that test.
The native Node timing run is scheduled in independent CI. No game, physical
GPU or inherited runtime is involved.

## Timing report verification and paired analysis

The dependency-free timing report tool validates the fixed 18-round protocol,
all six balanced orders, counts, positive bounded durations and recomputed
statistics. It reports within-round speedup medians, wins/ties/losses,
order-specific median ratios, position medians and first/last six-round
medians. These are descriptive diagnostics, not confidence intervals or
proof of provenance. JSON input is limited to 256 KiB; duplicate member
detection is not implemented. Eleven fixture cases passed in a JS isolate
with equivalent strict assertions; both real reports from CI run 45986926218
were independently parsed from logs and analyzed with the same implementation.

| Platform | Pair (baseline / candidate) | Median paired speedup | Candidate wins | Losses |
|---|---|---:|---:|---:|
| linux | linear_over_dense | 1.4991 | 18 | 0 |
| linux | linear_over_sparse | 1.5251 | 18 | 0 |
| linux | dense_over_sparse | 1.0149 | 14 | 4 |
| win32 | linear_over_dense | 1.1709 | 17 | 1 |
| win32 | linear_over_sparse | 1.3146 | 17 | 1 |
| win32 | dense_over_sparse | 1.1165 | 17 | 1 |

| Platform | Policy | Median ns | P95 ns | First six median ns | Last six median ns |
|---|---|---:|---:|---:|---:|
| linux | linear | 15128004 | 23079874 | 15549530.5 | 15051760 |
| linux | dense | 10138012 | 14171181 | 10122417 | 10138012 |
| linux | sparse | 9931914 | 13324950 | 10051438.5 | 9937920.5 |
| win32 | linear | 9235450 | 20123700 | 9957650 | 9068150 |
| win32 | dense | 7807350 | 10284000 | 7852600 | 7727350 |
| win32 | sparse | 7038500 | 13148300 | 7172000 | 6958250 |

The Windows and Linux runners differ in hardware and Node version; do not
pool them. With only 18 samples, nearest-rank P95 is the maximum. These
measure instrumented logical allocators on this synthetic workload only.
CI saves its current timing report and verifies it independently before
reporting paired diagnostics. No inherited runtime or game benchmark.

## Sparse AVL lookup elimination

Keep the original AVL unchanged. A subclass returns the selected node from
search and passes already known interval coordinates into deletion. Left
coalescing uses the existing end-address map; right coalescing reuses its
lookup. Coordinates are copied before successor substitution. No changes
to balancing or refresh logic. An independent aligned-address bitmap plan
checks exact placements, and each replay validates free intervals and AVL
metadata. Four crafted checks plus 12 prior traces passed in a JS isolate
using equivalent strict assertions. Observed counts (9600 requests each):

| Metric | Baseline | Candidate |
|---|---:|---:|
| accepted | 7611 | 7611 |
| visits | 56568 | 56568 |
| candidates | 9164 | 9164 |
| mutations | 327088 | 245979 |
| recalculations | 196688 | 196688 |
| rotations | 15620 | 15620 |

Both implementations fully reclaimed all 12 arenas. Mutation visits fell
by 24.7973%; this is an operation count, not runtime speedup.
Native CI also measures 18 alternating paired samples after three warmup
rounds, each covering 9600 requests, validating placements outside the
monotonic clock region. The timing harness was checked with a synthetic
clock on one trace, not used as timing evidence. No physical GPU or runtime
integration; real time results pending CI. Run
`node scripts/nexusvi_sparse_arena_v2.js`.

## Sparse AVL refresh elimination

CI run 45987482049 completed successfully for V2. Actual prior paired
measurements: Linux baseline 7936338.5 ns, V2 7695134.5 ns (median paired
speedup 1.029600, 16/18 wins); Windows baseline 11307050 ns, V2 11087750 ns
(median paired speedup 1.017215, 18/18 wins). These are instrumented logical
replays, not runtime or GPU performance.

V3 overrides only balance: it decides rotations using current child heights,
then refreshes the node once on the no-rotation path or uses the existing
rotation refreshes. The previous preliminary refresh is redundant on the
rotation path. V2 remains available, with the shared harness exported and
its default timing pair unchanged. All four rotation shapes and two
additional crafted cases passed; 12 identical traces checked against the
independent occupancy plan and AVL invariants after each request.

| Metric | V2 | V3 |
|---|---:|---:|
| accepted | 7611 | 7611 |
| visits | 56568 | 56568 |
| candidates | 9164 | 9164 |
| mutations | 245979 | 245979 |
| recalculations | 196688 | 185525 |
| rotations | 15620 | 15620 |

Counts measured in a JS isolate with equivalent strict assertions. All 12
arenas fully reclaimed; no time improvement inferred from refresh counts.
The 18-pair timing harness was verified with a synthetic clock on one trace.
Native CI will measure both versions after three warmup rounds. No changes
to inherited runtime. Run `node scripts/nexusvi_sparse_arena_v3.js`.

## Sparse AVL successor extraction (V4, V2 base)

CI run 45987782285 passed V3 correctness, but its actual paired timing
regressed: Linux V2 median 7310610.5 ns, V3 7786255 ns (paired ratio
0.938924, 0/18 candidate wins); Windows V2 11344850 ns, V3 12010400 ns
(paired ratio 0.944933, 4/18 wins). Therefore V2 is the reference for
this experiment, not V3. Preserve V3 as a negative result; no removal or
claim that the regression is universal.

V4 derives from V2 and changes only deletion of a two-child node: extract
its in-order successor in one recursive descent, substituting coordinates
before rebalancing. The former separate successor lookup is eliminated.
Six crafted cases passed, including immediate and deeper successors with
and without right children. The same 12 traces are checked against the
independent occupancy plan and AVL invariants after each request.

| Metric | V2 | V4 |
|---|---:|---:|
| accepted | 7611 | 7611 |
| visits | 56568 | 56568 |
| candidates | 9164 | 9164 |
| mutations | 245979 | 232659 |
| recalculations | 196688 | 196688 |
| rotations | 15620 | 15620 |

Counts observed in JS isolate with equivalent strict assertions, 9600
requests per implementation. All 12 arenas fully reclaimed. The timing
harness passed a synthetic-clock check on one trace; this is not timing
evidence. Native CI will measure 18 alternating pairs after three warmup
rounds. No inherited runtime changes or physical GPU performance claims.
Run `node scripts/nexusvi_sparse_arena_v4.js`.

## Independent AVL scaling and fragmentation experiment

CI run 45988076416 passed V4 correctness. Actual prior timings: Linux
V2 median 8766807 ns, V4 8822740 ns (paired ratio 0.990229, 4/18 wins);
Windows V2 8869550 ns, V4 8759300 ns (paired ratio 1.012043, 15/18 wins).
No consistent timing improvement across the two runners. Keep V2 as the
reference rather than selecting V4 on operation counts alone.

The new bounded experiment uses capacities 8192 and 16384, fresh seeds
104729 and 130363, a mixed trace and a fragmented-prefix trace for each
seed/capacity pair. The fragmented trace fills the arena with 32-byte
blocks, releases alternating blocks simultaneously and then issues 800
mixed requests; remaining initial blocks expire after 400 subsequent
requests. The independent occupancy plan and full AVL checks verify every
request; full reclamation is checked by the shared harness. Counts observed
in a JS isolate with equivalent strict assertions:

| Capacity | Requests per version | Accepted | V2 mutation visits | V4 mutation visits | Peak free nodes | Peak height |
|---|---:|---:|---:|---:|---:|---:|
| 8192 | 4512 | 3349 | 97456 | 92474 | 130 | 8 |
| 16384 | 5024 | 4069 | 125368 | 119514 | 258 | 9 |

Four construction checks and all eight comparative traces passed. The
shared timing harness was tested with a synthetic clock on one trace;
no real time is inferred. CI measures 18 alternating pairs per capacity
with three warmup rounds and checks every result outside the timed region.
Capacities are logical bytes, not real memory mappings. No inherited runtime
changes, physical GPU measurement or game benchmark.
Run `node scripts/nexusvi_sparse_scaling.js`.

## Scaling timing results and strict report JSON input

CI run 45988404724 passed both platforms. Scaling timings, nanoseconds:

| Platform | Capacity | V2 median | V4 median | Paired ratio | V4 wins |
|---|---:|---:|---:|---:|---:|
| linux | 8192 | 4237248 | 4237548.5 | 0.995862 | 7/18 |
| linux | 16384 | 5073205.5 | 5122728 | 0.987492 | 4/18 |
| win32 | 8192 | 4095000 | 4124600 | 0.989911 | 3/18 |
| win32 | 16384 | 4944950 | 5012350 | 0.984032 | 3/18 |

No production allocator selected. Preserve the negative and mixed results.

Both standalone graphics and timing report CLI readers now reject duplicate
JSON members, including equivalent escaped names, before native JSON parsing.
The bounded scan checks grammar, finite numbers, depth <=64 (root depth 0),
500000 values/member names and 4 Mi UTF-16 code units; existing file byte
limits remain unchanged. Object keys are tracked separately at each level.
This addresses ambiguous duplicate fields previously documented as a limitation.
It does not authenticate measurement origin. The parser passed 9
valid and 18 rejected cases in a JS isolate; both existing
fixture suites (26 graphics and 11 timing)
passed and duplicate scope fields were rejected. Native CLI/CI checks pending.

## Independent evidence manifest

The fixed evidence set contains arena-timing.json (measured instrumented
logical replay) and synthetic-graphics.json (fixture, not hardware evidence).
The manifest records exact byte lengths, SHA-256 digests, and the expected
40-character Git revision. CI independently checks its checkout HEAD against
GITHUB_SHA, creates the manifest exclusively, verifies it, and uploads the
three files per OS with 30-day retention. Files are bounded to 4 MiB; manifest
input to 64 KiB. Only the two fixed filenames are read; strict JSON and exact
schema validation reject ambiguous members and unexpected fields. Regular
file checks reject symlinks in the ordinary non-concurrent use case; this is
not a hostile concurrent filesystem sandbox. The manifest is unsigned and
cannot prove origin, execution or authenticity if both data and manifest are
replaced. It does not hash every dependency or guarantee reproducibility
across different runners. Compare against a separately trusted revision and
artifact source. No private hardware report is uploaded.

Run `node scripts/nexusvi_evidence_manifest.js verify DIRECTORY REVISION`.
14 core cases passed in a JS isolate using equivalent strict assertions
and deterministic test digests. Actual SHA-256 known-vector and filesystem
checks (including same-length alteration and missing file) are in native CI;
no native result is claimed before execution. Previous strict JSON CI run
45988704060 completed successfully on both platforms.

## Independent revision comparison

CI 45988989158 passed 18 manifest checks on each OS, verified both files,
and uploaded Windows artifact 15192173775 (2127 bytes) and Linux artifact
15193590617 (2199 bytes). Artifact metadata and CI logs checked; archive
bytes were not independently downloaded. The new comparison CLI reads both
fixed report files once per bundle, checks their SHA-256 and byte counts
against the manifest, then parses the same verified timing bytes. Both
expected revisions must differ; the fixed timing schema, declared platform,
architecture and Node version must match. It reports candidate/base median
and P95 time ratios and change in the within-run paired speedup relative to
linear. Different runs are not paired by round number. A shared slowdown
can affect absolute ratios while leaving relative ratios unchanged; the
linear baseline may itself change. Matching metadata does not establish
hardware or workload source equivalence. No automatic regression verdict,
confidence interval, authentication, or claim of production speed.

Run `node scripts/nexusvi_revision_compare.js BASE_DIR BASE_REV CANDIDATE_DIR CANDIDATE_REV`.
13 comparison core cases passed in a JS isolate with equivalent strict
assertions; 14 manifest and 11 timing core checks still passed.
Three additional filesystem tests and actual current CI bundle verification
are scheduled in native CI. No two real revision archives compared yet.

## Observed timing context and real archive comparison

CI runs 45988989158 (0275bbd) and 45989302040 (ce4b73d) passed. All four
ZIP archives downloaded; SHA-256 of each archive matched GitHub metadata;
all eight report byte lengths and hashes matched their manifests. Python
independently recomputed the median/P95/min/max from 216 duration samples.
The four timing workload source Git blobs were identical across revisions:

| Source | Git blob |
|---|---|
| nexusvi_arena_timing.js | b60d4a98f7391e2be06b60924c9e55dac43cccdf |
| nexusvi_fragmentation.js | e6e4020992a19299985ea1b4cf53285490e320ae |
| nexusvi_indexed_arena.js | 2098c7c490be0572cf447f8e10267e4783ba73ff |
| nexusvi_sparse_arena.js | c8f62f9802bbd5897489863e739889c10f48e9e1 |

Candidate/baseline median time ratios from the downloaded reports:

| Platform | Linear | Dense | Sparse |
|---|---:|---:|---:|
| Linux | 1.192661 | 1.138408 | 1.312128 |
| Windows | 2.032149 | 1.553245 | 1.734427 |

The observed variability despite identical workload blobs shows why separate
runner timings do not prove code regressions. No causal attribution made.
New reports observe SHA-256 and byte sizes of five fixed local source files
before timing, CPU model if uniform, logical CPU count, OS release and V8
version. The report validator checks the optional context; comparison
reports differing/unknown fields and matching observed digests, never
claims hardware equivalence or signed provenance. Old reports remain
readable, with context unavailable. Hashes reflect raw checkout bytes,
including line endings. This does not verify loaded code against subsequent
file changes, CPU frequency, host load, or physical hardware identity.
Ten context core cases, 11 timing and 13 comparison cases plus one context
integration passed in a JS isolate; actual native capture pending CI.

## Same-process repeatability control

CI 45989681557 passed both platforms. Context capture and bundle checks
were observed in the job logs:

- standalone (ubuntu-latest): {"cpu_model":"AMD EPYC 7763 64-Core Processor","logical_cpus":4,"os_release":"7.0.0-1020-azure","v8":"13.6.233.17-node.63"}; context tests=true; bundle=true.
- standalone (windows-latest): {"cpu_model":"AMD EPYC 7763 64-Core Processor","logical_cpus":4,"os_release":"10.0.26100","v8":"12.4.254.21-node.57"}; context tests=true; bundle=true.

The new repeatability control uses six consecutive blocks in one Node
process, each with three warmup rounds and 18 measured rounds of the
existing 9600-request workload. All six execution orders remain balanced
within each block. It reports raw timings, block median time, within-block
paired speedup relative to linear, median absolute deviation normalized by
the median, and min/max span normalized by the median. These describe this
short session only; they do not establish an independent-run noise bound,
a confidence interval, hardware equivalence or a regression threshold.
The same context snapshot is attached to each block and source digests
are checked again at the end; no claim of continuous environment stability.
Ten synthetic analyzer cases passed, and the full six-block harness ran
in a JS isolate with a simulated clock: 324 measured replays, 3110400
requests, exact placement verification. Simulated timing values are not
measurement evidence. Native CI records the real report in job logs; the
existing fixed artifact manifest remains unchanged.
Run `node scripts/nexusvi_repeatability.js`.

## Interleaved A/A and A/B control

Previous native repeatability CI 45990047676 passed. Six-block observed
median absolute deviation and normalized span of block medians:

| Runner | Policy | Relative MAD | Relative span |
|---|---|---:|---:|
| standalone (windows-latest) | linear | 3.7239% | 13.4361% |
| standalone (windows-latest) | dense | 3.1058% | 7.3257% |
| standalone (windows-latest) | sparse | 3.9440% | 11.5251% |
| standalone (ubuntu-latest) | linear | 1.1458% | 2.7982% |
| standalone (ubuntu-latest) | dense | 0.4955% | 3.8772% |
| standalone (ubuntu-latest) | sparse | 0.3634% | 1.4410% |

The same-process span is descriptive and cannot define a universal threshold.
The new interleaved experiment runs A1 and A2 using exactly the same V2 class,
and B using the original AVL class, in all six orders six times. Each sample
replays 9600 requests with independent exact placement validation outside
timing. It reports A/A signed median ratio and median/max absolute log ratio;
B relative to the geometric mean of A1 and A2, order-specific ratios and
counts slower/faster than both identical controls. No statistical test or
causal regression verdict is claimed; order, JIT and garbage collection can
still influence results. Existing implementation behavior is unchanged,
only harness exports added. Ten synthetic checks and 108 full-suite measured
path executions (1036800 requests) passed in a JS isolate with a synthetic
clock. Native timings pending CI. Run `node scripts/nexusvi_interleaved_control.js`.

## Independent logical cache policy experiment

Interleaved CI 45990365981 passed. Observed A/A absolute median log ratio
and B/original relative to the geometric mean of two V2 controls:

| Runner | A/A absolute median log ratio | B/A median ratio | B slower than both | B faster than both |
|---|---:|---:|---:|---:|
| standalone (ubuntu-latest) | 0.008078 | 1.031048 | 33/36 | 1/36 |
| standalone (windows-latest) | 0.011146 | 1.031493 | 30/36 | 2/36 |

Close this measurement-infrastructure phase; no causal or universal
performance threshold inferred. New independent experiment compares FIFO,
LRU and segmented LRU with a protected segment limited to floor(cap/2).
Misses enter probation; probation hits promote; protected overflow demotes
its oldest key; misses at full capacity evict oldest probation key. An
array oracle verifies every hit, eviction and ordering, with bounded unique
resident keys. Six crafted checks and 24576 exhaustive length-six
histories (four keys, capacities 2 and 3, all policies) passed. Sixteen
6000-access traces (capacities 32/128, two seeds, four profiles) passed in
JS isolate with equivalent strict assertions, 288000 accesses across
policies. Observed hits, aggregated per profile across four traces:

| Profile | Requests per policy | FIFO | LRU | SLRU |
|---|---:|---:|---:|---:|
| uniform | 24000 | 6058 | 6029 | 6068 |
| hot_scan | 24000 | 10335 | 10335 | 12139 |
| phase_shift | 24000 | 18766 | 19154 | 19036 |
| cyclic | 24000 | 0 | 0 | 0 |

Each key consumes one logical slot; no byte weighting, physical cache,
latency, timing or production integration. Cyclic traces intentionally do
not depend on seed and are repeated for uniform experiment structure;
counts are not independent statistical samples. Native CI pending.
Run `node scripts/nexusvi_cache_policies.js`.

## Adaptive logical segmented cache with bounded ghost history

Prior cache CI 45990631346 passed on both platforms, with identical totals
(35159 FIFO, 35518 LRU, 37243 SLRU hits over 96000 requests per policy).
The adaptive experiment preserves those baselines. It uses a protected
target bounded to [1,cap-1] and a ghost history of at most cap evicted keys,
marked by whether reused. A ghost hit is still a miss; it adjusts the
target by one (previously reused increases protection, otherwise decreases
it), then admits the key to protection. Demotions preserve the reuse mark.
An independent array model checks each hit, eviction, resident/ghost order,
target and uniqueness. Four crafted checks and 46875
exhaustive length-six histories passed in a JS isolate using equivalent
strict assertions. The original 16 traces plus 12 additional noncyclic
traces were replayed by all four policies (672000 accesses). Observed hits:

| Group | Profile | Requests per policy | FIFO | LRU | SLRU | Adaptive | Ghost hits | Target changes |
|---|---|---:|---:|---:|---:|---:|---:|---:|
| prior | uniform | 24000 | 6058 | 6029 | 6068 | 6012 | 5764 | 5441 |
| prior | hot_scan | 24000 | 10335 | 10335 | 12139 | 12139 | 5 | 5 |
| prior | phase_shift | 24000 | 18766 | 19154 | 19036 | 19121 | 401 | 225 |
| prior | cyclic | 24000 | 0 | 0 | 0 | 0 | 23676 | 468 |
| additional | uniform | 24000 | 5985 | 5995 | 5850 | 6003 | 5864 | 5620 |
| additional | hot_scan | 24000 | 10336 | 10336 | 12141 | 12141 | 3 | 3 |
| additional | phase_shift | 24000 | 18543 | 18972 | 18863 | 18938 | 428 | 238 |

Ghost keys are additional metadata (at most as many as resident slots),
not cached values or free memory. This is a heuristic, not ARC, and no
universal benefit or real memory/latency gain is claimed. The same workload
families are reused; additional seeds are not independent workload classes.
Cyclic traces are seed-independent; retained solely for baseline comparison.
Native CI pending. Run `node scripts/nexusvi_cache_adaptive.js`.

## Independent byte-budget logical cache

Adaptive CI 45990934472 passed on both platforms. Recomputed exact totals
from native reports (168000 accesses each): FIFO 70023, LRU 70821,
SLRU 74097, adaptive 74354. Adaptive gains 257 hits vs SLRU (0.347%
relative), not a demonstrated improvement in runtime or physical memory.

New weighted cache stores immutable-sized objects within a logical byte
budget. FIFO and LRU are compared with largest4: evict the largest among
the four oldest residents (ties oldest), repeat until enough room. Objects
larger than the budget bypass without eviction. Resident size changes are
rejected. Independent timestamp/sort oracle checks every hit, eviction,
ordering and byte accounting. Six crafted cases and 24576
exhaustive histories passed; 16 traces of 4000 accesses at 4096/16384
logical bytes, two seeds, four profiles were replayed by all policies
(192000 accesses). Small-hot is a variant of hot-scan, not an independent
access pattern. Observed counts in JS isolate with equivalent assertions:

| Profile | Policy | Requests | Hits | Requested bytes | Hit bytes | Evictions | Bypasses | Victim inspections |
|---|---|---:|---:|---:|---:|---:|---:|---:|
| uniform | fifo | 16000 | 1471 | 8607595 | 483712 | 14071 | 331 | 14071 |
| uniform | lru | 16000 | 1481 | 8607595 | 486208 | 14065 | 331 | 14065 |
| uniform | largest4 | 16000 | 1692 | 8607595 | 488896 | 13843 | 331 | 55372 |
| hot_scan | fifo | 16000 | 6319 | 12141449 | 2903424 | 8719 | 841 | 8719 |
| hot_scan | lru | 16000 | 6319 | 12141449 | 2903424 | 8713 | 841 | 8713 |
| hot_scan | largest4 | 16000 | 6319 | 12141449 | 2903424 | 8703 | 841 | 34812 |
| small_hot | fifo | 16000 | 6319 | 8969641 | 202208 | 8658 | 841 | 8658 |
| small_hot | lru | 16000 | 6319 | 8969641 | 202208 | 8658 | 841 | 8658 |
| small_hot | largest4 | 16000 | 6319 | 8969641 | 202208 | 8648 | 841 | 34592 |
| phase_shift | fifo | 16000 | 9420 | 10282010 | 3222464 | 5992 | 474 | 5992 |
| phase_shift | lru | 16000 | 10686 | 10282010 | 3646208 | 4722 | 474 | 4722 |
| phase_shift | largest4 | 16000 | 10860 | 10282010 | 3630848 | 4538 | 474 | 18152 |

Hit bytes count logical payload volume served by hits, including repeated
reads. Metadata cost is excluded. Victim inspections are operation counts,
not wall time. No physical cache, GPU or runtime integration. Native CI
pending. Run `node scripts/nexusvi_cache_weighted.js`.

## Independent second-touch admission for weighted cache

Weighted CI 45991247013 passed on both platforms, matching prior hit counts
(23529 FIFO, 24805 LRU, 25190 largest4). New policy wraps byte-budget LRU:
first eligible miss remembers only its key in bounded FIFO history; a
second occurrence while remembered admits and removes that history key.
Resident hits update LRU; oversized objects bypass without modifying
history. Evicted residents must qualify again. Compare two history limits
(cap/128 and cap/32 keys), both excluding metadata from logical byte budget.
Independent timestamp/array model checks every outcome, byte count, LRU
order and history uniqueness. Six crafted checks and 16384
exhaustive short histories passed in JS isolate; 24 traces, 288000 comparative
accesses. Isolate assertion shim compares object keys independent of order.
Additional seed 104729 is separated from the 16 prior traces.
Observed totals:

| Policy | Requests | Hits | Hit bytes | Evictions | Filtered first misses | Peak history keys |
|---|---:|---:|---:|---:|---:|---:|
| lru | 96000 | 37498 | 10906240 | 54025 | 0 | 0 |
| second | 96000 | 40851 | 11758208 | 7450 | 43394 | 128 |
| second4 | 96000 | 40831 | 11738464 | 12069 | 38825 | 512 |

Additional seed alone:

| Policy | Hits | Hit bytes | Evictions |
|---|---:|---:|---:|
| lru | 12693 | 3668192 | 17867 |
| second | 13720 | 3926848 | 2492 |
| second4 | 13765 | 3950144 | 3981 |

Filtered misses are not hits. Metadata key counts are not physical memory
costs. Extra seeds reuse workload families; no timing or runtime gain
claimed. Native CI pending. Run `node scripts/nexusvi_cache_admission.js`.

## Independent weighted-cache timing

Admission CI 45991632678 passed on both platforms; recomputed hits 37498
LRU, 40851 second-touch, 40831 second4. New timing experiment uses all
24 existing traces, separated into four profiles, each 24000 accesses per
sample. Eighteen measured rounds with all six execution orders balanced,
three warmup rounds per profile. Before timing, independent timestamp
oracles generate expected events and final resident/history states. Timed
region includes construction, request dispatch, policy logic and outcome
recording; outside timing compare every hit, bypass, filtered miss,
eviction sequence and final state. No actual payload allocation or I/O.
Nine synthetic analyzer/harness checks passed, and all 24 plans were
constructed. Full uniform profile ran 54 measured replays (1296000
requests) using a simulated clock in JS isolate with structural assertions.
No native timing claim yet. Native CI will measure all four profiles
(216 samples, 5184000 measured accesses), recording raw samples and
within-round ratios. Existing algorithms unchanged except oracle exports.
Run `node scripts/nexusvi_cache_timing.js`.

## Independent size-sensitive logical admission

Native timing CI 45991947495 passed on both platforms. Median paired LRU
/ candidate time ratio (greater than one favors candidate):

| Runner | Profile | Second | Second4 | Second faster rounds |
|---|---|---:|---:|---:|
| standalone (windows-latest) | uniform | 1.051032 | 1.055027 | 13/18 |
| standalone (windows-latest) | hot_scan | 1.114386 | 1.012021 | 16/18 |
| standalone (windows-latest) | small_hot | 1.051102 | 0.943801 | 11/18 |
| standalone (windows-latest) | phase_shift | 0.958515 | 1.012759 | 6/18 |
| standalone (ubuntu-latest) | uniform | 1.045228 | 0.998409 | 16/18 |
| standalone (ubuntu-latest) | hot_scan | 1.035986 | 0.859463 | 18/18 |
| standalone (ubuntu-latest) | small_hot | 1.020506 | 0.856025 | 15/18 |
| standalone (ubuntu-latest) | phase_shift | 0.933595 | 0.949370 | 3/18 |

These timings include recording outcomes but not actual payload I/O.
New size-sensitive admission uses fixed thresholds (<=64 logical bytes:
first touch; 65–256: second; >256: third), with the same history key
limit as second-touch. History counts are bounded to 1 or 2 and refresh
recency on repeat. Oversized objects bypass; resident hits update LRU.
This heuristic deliberately favors small objects; no threshold tuning or
universal optimality claimed. Independent timestamp and array oracle checks
every event, eviction, resident/history order and capacity. Six crafted
checks and 16384 exhaustive histories passed in JS isolate;
32 traces (384000 comparative accesses) including eight additional traces
(seed 130363). Observed totals:

| Policy | Requests | Hits | Hit bytes | Evictions |
|---|---:|---:|---:|---:|
| lru | 128000 | 50187 | 14645120 | 71880 |
| second | 128000 | 54660 | 15774560 | 9881 |
| size | 128000 | 57222 | 15084256 | 22654 |

Additional seed alone:

| Policy | Hits | Hit bytes | Evictions |
|---|---:|---:|---:|
| lru | 12689 | 3738880 | 17855 |
| second | 13809 | 4016352 | 2431 |
| size | 14482 | 3840576 | 5567 |

Metadata costs excluded from logical capacity; no payload memory or
native timing claim for new variant. Native CI pending.
Run `node scripts/nexusvi_cache_size_admission.js`.

## Abstract weighted-cache cost sensitivity

CI 45992272660 passed Windows and Linux; both native reports reproduce the
same cost vectors and sensitivity results as the independently replayed
32 traces. New tool compares miss count, missed logical bytes and eviction
count, with nonnegative integer coefficients and exact BigInt arithmetic.
The grid covers 35 nonzero combinations of coefficients per group; six
groups yield 210 scenarios. No coefficients are calibrated to actual
latency, I/O, power, memory or monetary cost. Metadata/admission overhead
is excluded. Scenario counts depend on the arbitrary illustrative grid,
not a probability distribution. Pareto dominance requires no worse in all
three metrics and strictly better in at least one. Ties preserved.

| Group | LRU unique wins | Second unique wins | Size unique wins | Ties | Pareto frontier |
|---|---:|---:|---:|---:|---|
| all | 0 | 21 | 14 | 0 | second, size |
| additional | 0 | 21 | 14 | 0 | second, size |
| uniform | 3 | 14 | 18 | 0 | lru, second, size |
| hot_scan | 0 | 35 | 0 | 0 | second |
| small_hot | 0 | 20 | 15 | 0 | second, size |
| phase_shift | 0 | 21 | 14 | 0 | second, size |

All 11 core checks passed in JS isolate, including exact integer overflow
avoidance and ties; all 32 workload traces replayed with independent oracle
checks. Native CI for new tool pending. Run `node scripts/nexusvi_cache_cost.js`.

## Independent snapshot batch coalescing

CI 45992596689 passed on both platforms: 11 cost checks and 210 scenarios
confirmed, aggregate unique winners second=21 and size=14 of 35. The cache
phase is retained without production policy selection.

New logical batch model coalesces pure set/delete operations by key, with
last operation winning within each bounded batch. Flush after 16 or 64
updates, on explicit barrier, or at end. Optional no-op filtering checks
current state once per coalesced key. It is valid only where intermediate
states, operation ordering, acknowledgements and side effects are not
observable; not a general transaction engine. The array oracle and eager
map are compared with both batch variants at every flush/barrier and end.
Six crafted cases and 15552 exhaustive length-five histories
passed in JS isolate; twelve deterministic synthetic runs. Observed
backend mutation attempts (including no-op deletes) and filter reads:

| Profile | Batch limit | Eager | Coalesced | Filtered | Filter reads | Checkpoints |
|---|---:|---:|---:|---:|---:|---:|
| uniform | 16 | 8192 | 7970 | 7524 | 7970 | 578 |
| uniform | 64 | 8192 | 7282 | 6853 | 7282 | 194 |
| hot | 16 | 8192 | 3644 | 3482 | 3644 | 578 |
| hot | 64 | 8192 | 1024 | 977 | 1024 | 194 |
| repeated | 16 | 8192 | 512 | 224 | 512 | 578 |
| repeated | 64 | 8192 | 512 | 224 | 512 | 194 |

Counts exclude Map operations in the buffer; no wall time, storage I/O,
physical memory or runtime performance claim. No-op filtering exchanges
reads for fewer mutation attempts. Native CI pending.
Run `node scripts/nexusvi_batch_coalesce.js`.

## Independent adaptive snapshot batching

CI 45993134049 passed on Windows and Linux, confirming 49152 updates,
20944 coalesced writes, 19284 filtered writes, 20944 filter reads and
2316 snapshot checks. Adaptive policy starts at 16 updates per batch,
doubles on a full batch with at least half redundant keys, halves on a
full batch with at most one eighth redundant keys; bounded to [16,64].
Explicit barriers flush; partial flushes do not change target.
Array state and separate boundary model verify state, target and logical
waiting counts. Waiting is subsequent updates before flush, not time;
each batch of n contributes n(n-1)/2. All variants filter no-op writes.
Nine crafted checks and 3125 exhaustive short histories passed
in JS isolate. Twelve traces include mixed phases every 512 updates,
three deterministic seeds, 147456 comparative updates.

| Profile | Policy | Updates | Writes | Reads | Flushes | Sum waiting updates | Peak batch | Changes |
|---|---|---:|---:|---:|---:|---:|---:|---:|
| uniform | fixed16 | 12288 | 11278 | 11929 | 768 | 92160 | 16 | 0 |
| uniform | fixed64 | 12288 | 10241 | 10867 | 192 | 387072 | 64 | 0 |
| uniform | adaptive | 12288 | 11278 | 11929 | 768 | 92160 | 16 | 0 |
| hot | fixed16 | 12288 | 5207 | 5452 | 768 | 92160 | 16 | 0 |
| hot | fixed64 | 12288 | 1460 | 1536 | 192 | 387072 | 64 | 0 |
| hot | adaptive | 12288 | 1499 | 1577 | 198 | 383232 | 64 | 6 |
| repeated | fixed16 | 12288 | 338 | 768 | 768 | 92160 | 16 | 0 |
| repeated | fixed64 | 12288 | 338 | 768 | 192 | 387072 | 64 | 0 |
| repeated | adaptive | 12288 | 338 | 768 | 198 | 383232 | 64 | 6 |
| mixed | fixed16 | 12288 | 6255 | 6693 | 768 | 92160 | 16 | 0 |
| mixed | fixed64 | 12288 | 4460 | 4831 | 192 | 387072 | 64 | 0 |
| mixed | adaptive | 12288 | 4910 | 5292 | 390 | 281856 | 64 | 30 |

Adaptive is not universally superior: repeated profile gains no write
reduction over fixed16 while waiting increases. No measured wall time,
real storage or runtime integration. Snapshot-only semantics remain.
Native CI pending. Run `node scripts/nexusvi_batch_adaptive.js`.

## Independent batch cost sensitivity

Prior adaptive CI 45995247153 passed on both platforms. Compare abstract nonnegative integer costs for writes, reads and logical waiting, using exact BigInt arithmetic. Five checks and 144 illustrative scenarios passed in JS isolate. Grid is not a probability distribution; buffer overhead and physical timing excluded. Native CI pending.

[{"profile":"uniform","wins":{"fixed16":0,"fixed64":9,"adaptive":0},"ties":27,"scenarios":36},{"profile":"hot","wins":{"fixed16":24,"fixed64":12,"adaptive":0},"ties":0,"scenarios":36},{"profile":"repeated","wins":{"fixed16":27,"fixed64":0,"adaptive":0},"ties":9,"scenarios":36},{"profile":"mixed","wins":{"fixed16":24,"fixed64":12,"adaptive":0},"ties":0,"scenarios":36}]

## Independent CPU dirty-tile framebuffer

Original opaque rectangle compositor with fixed 128x96 output and 16x16 tiles. Dirty regions include old/new bounds for geometry, color and z-order changes, additions and removals. Stable order is z then ID. Each dirty tile is cleared and composited from all intersecting layers. A separate pixel-major reference verifies every pixel, including clipping, overlap and unchanged frames. No GPU, proprietary assets, inherited runtime or display timing. Counts measure cleared/redrawn pixel area, not total computation; paint writes and reference validation are separate. Only opaque rectangles, not a general renderer.

Local JS isolate: 12 crafted checks, 720 frames, 8847360 exact pixel comparisons; four profiles, three fixed seeds. Results:

```json
[
  {
    "profile": "static",
    "frames": 180,
    "fullPixels": 2211840,
    "redrawPixels": 28928,
    "paintPixels": 21300
  },
  {
    "profile": "localized",
    "frames": 180,
    "fullPixels": 2211840,
    "redrawPixels": 219904,
    "paintPixels": 178510
  },
  {
    "profile": "scroll",
    "frames": 180,
    "fullPixels": 2211840,
    "redrawPixels": 858880,
    "paintPixels": 523455
  },
  {
    "profile": "churn",
    "frames": 180,
    "fullPixels": 2211840,
    "redrawPixels": 884224,
    "paintPixels": 549386
  }
]
```

Run `node scripts/nexusvi_dirty_tiles.js`. Native CI scheduled, not yet confirmed. No FPS improvement claimed.

## Independent CPU tile binning

A standalone synthetic opaque rectangle rasterizer compares scanning all 96 layers per tile with a spatial bin index built each frame. Rectangles are clipped and inserted in stable z/ID order into overlapping 16x16 tiles of a 256x192 framebuffer. A separate rectangle-major per-pixel reference verifies both output buffers. The index is rebuilt on every frame, not integrated with the dirty tile prototype. Counts separate rectangle/tile checks, build clipping checks, bin entries and paint writes; bin construction and allocations are not free. No wall time, GPU, game assets or runtime integration. Fullscreen is an intentionally adverse case.

Local JS isolate: 9 crafted checks, 144 frames, 7077888 pixels checked against each of two implementations (14155776 comparisons). Results:

```json
[
  {
    "profile": "small",
    "frames": 36,
    "linearChecks": 663552,
    "indexedChecks": 8625,
    "buildChecks": 3456,
    "entries": 8625,
    "paint": 569949,
    "peakEntries": 275
  },
  {
    "profile": "mixed",
    "frames": 36,
    "linearChecks": 663552,
    "indexedChecks": 31675,
    "buildChecks": 3456,
    "entries": 31675,
    "paint": 5434684,
    "peakEntries": 1148
  },
  {
    "profile": "offscreen",
    "frames": 36,
    "linearChecks": 663552,
    "indexedChecks": 2908,
    "buildChecks": 3456,
    "entries": 2908,
    "paint": 189054,
    "peakEntries": 109
  },
  {
    "profile": "fullscreen",
    "frames": 36,
    "linearChecks": 663552,
    "indexedChecks": 663552,
    "buildChecks": 3456,
    "entries": 663552,
    "paint": 169869312,
    "peakEntries": 18432
  }
]
```

Run `node scripts/nexusvi_tile_binning.js`. Native CI not yet verified. No FPS claim.

## Independent integrated CPU compositor (Core prototype)

Combines dirty-region tracking, spatial bins restricted to changed tiles, and a full-frame rectangle-major fallback when at least half the tiles are dirty. Unchanged frames skip painting. The threshold is illustrative, not tuned. Compares full, dirty-only and adaptive paths on the same generated scenes. Independent pixel-major oracle checks every pixel of each path before timing; final outputs of each timed trace also checked. Timed work includes scene validation, copying, sorting, index construction, allocations, and painting; excludes scene generation and comparison. All six execution orders balanced. Local JS-isolate Date.now timings are coarse wall-clock observations (not monotonic; scheduling and JIT effects possible), not native Node or GPU evidence. Native CI uses monotonic hrtime and twelve rounds; no performance gate. Dense overlap is deliberately adverse. No inherited runtime, game assets or hardware GPU claims.

Local verification and raw timings:

```json
{
  "verification": {
    "frames": 720,
    "comparisons": 106610688,
    "paths": {
      "skip": 220,
      "binned": 321,
      "full": 179
    },
    "crafted": 9
  },
  "timing": {
    "clock": "js_isolate_Date_now_ms",
    "rounds": 6,
    "results": [
      {
        "profile": "static",
        "framesPerSample": 144,
        "samplesMs": {
          "full": [
            14,
            14,
            14,
            13,
            14,
            14
          ],
          "dirty": [
            10,
            11,
            11,
            11,
            11,
            11
          ],
          "adaptive": [
            8,
            8,
            10,
            8,
            8,
            8
          ]
        },
        "medianMs": {
          "full": 14,
          "dirty": 11,
          "adaptive": 8
        }
      },
      {
        "profile": "local",
        "framesPerSample": 144,
        "samplesMs": {
          "full": [
            21,
            13,
            13,
            14,
            14,
            14
          ],
          "dirty": [
            27,
            19,
            21,
            19,
            19,
            18
          ],
          "adaptive": [
            15,
            15,
            16,
            16,
            15,
            16
          ]
        },
        "medianMs": {
          "full": 14,
          "dirty": 19,
          "adaptive": 15.5
        }
      },
      {
        "profile": "scroll",
        "framesPerSample": 144,
        "samplesMs": {
          "full": [
            13,
            12,
            12,
            13,
            12,
            12
          ],
          "dirty": [
            129,
            121,
            121,
            122,
            130,
            125
          ],
          "adaptive": [
            29,
            28,
            29,
            29,
            31,
            29
          ]
        },
        "medianMs": {
          "full": 12,
          "dirty": 123.5,
          "adaptive": 29
        }
      },
      {
        "profile": "churn",
        "framesPerSample": 144,
        "samplesMs": {
          "full": [
            12,
            12,
            11,
            12,
            12,
            12
          ],
          "dirty": [
            53,
            53,
            53,
            58,
            52,
            52
          ],
          "adaptive": [
            27,
            28,
            28,
            28,
            28,
            27
          ]
        },
        "medianMs": {
          "full": 12,
          "dirty": 53,
          "adaptive": 28
        }
      },
      {
        "profile": "dense",
        "framesPerSample": 144,
        "samplesMs": {
          "full": [
            73,
            72,
            74,
            71,
            72,
            71
          ],
          "dirty": [
            629,
            598,
            602,
            599,
            596,
            606
          ],
          "adaptive": [
            84,
            83,
            81,
            82,
            80,
            84
          ]
        },
        "medianMs": {
          "full": 72,
          "dirty": 600.5,
          "adaptive": 82.5
        }
      }
    ]
  }
}
```

Run `node scripts/nexusvi_core_compositor.js`. Native CI pending.

## Independent CPU compositor V2: skip and opaque occlusion

Prior integrated experiment showed spatial bookkeeping losing to a simple full pass on four of five profiles. V2 deliberately drops tile bookkeeping in favor of reusable scratch maps, unchanged immutable internal snapshots, a reused sorting array, skip on identical scenes, and full painting with an opaque full-coverage layer cutoff. No reliance on caller object identity; all scalar fields validated and changed records copied; duplicate/invalid input rejected before changing the prior framebuffer. Scope limited to opaque axis-aligned rectangles; not suitable for alpha blending without different semantics. Original V1 only exports existing test helpers, no algorithm change. Compare full, prior adaptive and V2, with two additional seeds and a cover/reveal profile. Full pixel validation before timing; final pixels verified after each timed trace. Wall time includes setup, validation, snapshots, sorting and drawing. JS isolate Date.now is coarse and not monotonic; native CI uses monotonic hrtime, twelve balanced rounds. No GPU or inherited runtime claims. Local results (including raw samples):

```json
{
  "verification": {
    "frames": 1440,
    "pixelComparisons": 70778880,
    "paths": {
      "skip": 350,
      "full": 835,
      "occluded": 255
    },
    "craftedSequences": 11
  },
  "timing": {
    "clock": "js_isolate_Date_now_ms",
    "rounds": 6,
    "results": [
      {
        "profile": "static",
        "framesPerSample": 240,
        "samplesMs": {
          "full": [
            24,
            24,
            24,
            27,
            23,
            23
          ],
          "v1": [
            14,
            14,
            14,
            13,
            14,
            14
          ],
          "v2": [
            5,
            4,
            5,
            5,
            4,
            4
          ]
        },
        "medianMs": {
          "full": 24,
          "v1": 14,
          "v2": 4.5
        }
      },
      {
        "profile": "local",
        "framesPerSample": 240,
        "samplesMs": {
          "full": [
            24,
            24,
            24,
            24,
            23,
            23
          ],
          "v1": [
            26,
            25,
            26,
            26,
            26,
            26
          ],
          "v2": [
            20,
            20,
            19,
            19,
            20,
            20
          ]
        },
        "medianMs": {
          "full": 24,
          "v1": 26,
          "v2": 20
        }
      },
      {
        "profile": "scroll",
        "framesPerSample": 240,
        "samplesMs": {
          "full": [
            21,
            21,
            22,
            21,
            21,
            22
          ],
          "v1": [
            45,
            45,
            45,
            46,
            44,
            45
          ],
          "v2": [
            17,
            17,
            18,
            18,
            17,
            18
          ]
        },
        "medianMs": {
          "full": 21,
          "v1": 45,
          "v2": 17.5
        }
      },
      {
        "profile": "churn",
        "framesPerSample": 240,
        "samplesMs": {
          "full": [
            20,
            21,
            20,
            20,
            20,
            20
          ],
          "v1": [
            47,
            48,
            52,
            48,
            48,
            48
          ],
          "v2": [
            17,
            16,
            17,
            17,
            18,
            18
          ]
        },
        "medianMs": {
          "full": 20,
          "v1": 48,
          "v2": 17
        }
      },
      {
        "profile": "dense",
        "framesPerSample": 240,
        "samplesMs": {
          "full": [
            117,
            119,
            120,
            124,
            119,
            121
          ],
          "v1": [
            138,
            133,
            133,
            136,
            137,
            140
          ],
          "v2": [
            5,
            6,
            5,
            5,
            5,
            5
          ]
        },
        "medianMs": {
          "full": 119.5,
          "v1": 136.5,
          "v2": 5
        }
      },
      {
        "profile": "cover",
        "framesPerSample": 240,
        "samplesMs": {
          "full": [
            30,
            27,
            27,
            27,
            27,
            26
          ],
          "v1": [
            36,
            35,
            36,
            36,
            37,
            35
          ],
          "v2": [
            16,
            15,
            16,
            15,
            15,
            15
          ]
        },
        "medianMs": {
          "full": 27,
          "v1": 36,
          "v2": 15
        }
      }
    ]
  }
}
```

Run `node scripts/nexusvi_core_v2.js`. Native CI pending.

## Independent native EGL/OpenGL correctness control

Original Linux Python ctypes program initializes an EGL pbuffer, binds desktop OpenGL, uses scissor-restricted color clears to compose moving overlapping opaque rectangles, then reads RGBA8 pixels and compares against a separate pixel-major CPU oracle. No external data, shader compilation, triangles, FPS, GPU memory measurements, or inherited runtime. Fail closed on initialization or pixel error. Uses software rendering in CI; physical GPU verification is always false. Local actual Linux execution with Mesa 25.0.7 llvmpipe LLVM 19.1.7, OpenGL 4.5 compatibility, EGL 1.5: 64 frames, 196608 pixels, 786432 bytes compared, zero mismatches. Source SHA-256 of locally tested file: d59464806afe6b2a74a9737837a3a4a7ec3ff5411d3140ba1b37df3eafdf40a7. Run `python3 scripts/nexusvi_egl_control.py` on Linux with libEGL and libGL plus a working EGL implementation. Separate Linux CI job added; remote result pending. This is native API execution on software, not hardware acceleration or port compatibility evidence.

## ULTRA native validation wave (base 499a2e3)

Scope: independent tools only; inherited Rust workspace includes core, PE, loader, HLE, GPU, shader, formats, pipeline and game crates, not built here (Rust toolchain unavailable). No proprietary workloads. Linux x86_64, Python 3.13.5, Mesa 25.0.7-2 llvmpipe LLVM 19.1.7, OpenGL 4.5 / EGL 1.5. Baseline EGL control rerun before changes: 64 frames and 196608 exact pixels, passed. Existing context lifecycle now accepts an optional callback; original control remains unchanged in behavior.

- `LIBGL_ALWAYS_SOFTWARE=1 python3 scripts/nexusvi_gl_pipeline.py`: two successful local runs; original 64-frame regression passes each time. GLSL 430 vertex/fragment program, fullscreen triangle (3072 exact RGBA pixels), invalid shader rejection, compute shader on SSBO with unsigned wraparound, six buffer sizes (1,63,64,65,1024,4097), 5314 exact integer values, explicit buffer-update barrier and synchronous readback, resource cleanup. Second run dispatch+barrier+readback wall times in ns: [579693,77046,60682,68964,82484,74191]. These are single observations per different size, not GPU timestamps, speedups or FPS.
- `python3 scripts/nexusvi_vulkan_probe.py`: local loader present, vkCreateInstance returned -9 (VK_ERROR_INCOMPATIBLE_DRIVER), exit 2. No physical device or Vulkan workload verified. Discovery is implemented and fails explicitly; successful path remains untested locally. No new CI privilege or secret. Separate software Vulkan package/test added to existing Linux graphics job; CI pending.
- `python3 -m py_compile` on all three scripts: exit 0. Tested Git blobs verified before commit. Physical hardware and Windows native graphics remain unverified. No runtime integration or compatibility score claim.

### ULTRA second wave: textures, transfer offsets and bounded synchronization

`LIBGL_ALWAYS_SOFTWARE=1 python3 scripts/nexusvi_gl_transfers.py` executed locally (same environment), exit 0; all previous 64 clear frames, raster and compute checks passed again. Five RGB8 texture sizes, including odd widths, use alignment 1 and partial texel update; 30942 bytes exact. Five copy-buffer sizes 1,3,63,4097,65536 bytes with distinct offsets, guard bytes, fence and bounded 2 s wait; 69740 destination bytes exact. Observed copy+fence+readback wall ns [35102,4957,4137,6180,15233] (one observation per size, not GPU timing or throughput comparison). Cleanup in finally, pack/unpack restored for the standalone context. py_compile exit 0. Blob matched locally executed file. Native Linux software CI now runs the combined suite, preserving preceding checks. No physical VRAM budget, asynchronous overlap or leak measurement established. Vulkan remains locally blocked; CI results pending.

## ULTRA offscreen rendering wave

References reviewed (design ideas only, no imported implementation): Khronos [Vulkan Samples](https://docs.vulkan.org/samples/latest/samples/performance/pipeline_cache/README.html) for pipeline reuse, [VMA](https://gpuopen.com/vulkan-memory-allocator/) for allocation/budget concepts, and [VK-GL-CTS](https://github.com/KhronosGroup/VK-GL-CTS) for targeted state regressions. No conformance certification implied.

At base `179f29c`, all four local source blobs matched the earlier recorded Git hashes. Linux x86_64 Python 3.13.5 Mesa 25.0.7-2 llvmpipe LLVM 19.1.7 baseline suite reran successfully; Vulkan probe again returned -9, exit 2, no driver. No Rust workspace build or full runtime audit. New `LIBGL_ALWAYS_SOFTWARE=1 python3 scripts/nexusvi_gl_framebuffer.py` passed with preceding regressions, five offscreen attachment resize cases (including 1x1 and odd dimensions), 15 readbacks, 34902 pixels checked, zero mismatches outside predefined tolerance (exact depth colors, blend <=1 LSB per channel), empty framebuffer rejected, resources deleted. Python compilation passed. Local blob cdd568522a03b6c2c101826b8ffa0db714281f73 verified before commit. No physical GPU, no game, no FPS/VRAM performance claim. CI pending.

### ULTRA program binary roundtrip

Inspired by public Khronos pipeline reuse concepts, original OpenGL implementation only. `LIBGL_ALWAYS_SOFTWARE=1 python3 scripts/nexusvi_gl_cache.py` passed locally including all previous graphics regressions. Three original shader programs compiled, linked, exported to binary, then loaded into new program objects in the same context. All six draws matched 18432 pixels exactly. Nine envelope rejections for altered identity, source and payload; SHA-256 is integrity checking, not authentication. Binary lengths 3519 bytes each, bounded to 8 MiB. No untrusted binary sent to the driver. Compile/link wall ns [2927237,1330343,1282921]; binary load wall ns [169645,93521,93090]. These single observations of three distinct programs are not a controlled benchmark; do not infer speedups. No disk persistence, cross-context, cross-driver or Vulkan cache claim. Program formats must be supported; unavailable formats fail explicitly in this test. Python compilation passed; local blob 9dcb79d1d8ed6a15c6ff1eb4b8644cc9408f9903 verified. Existing Linux software CI runs complete suite; result pending.

## ULTRA research follow-through: native evidence collector

Re-ran the original five GL controls locally at base 8f7b323 (source blobs matched), all passed. Vulkan returned -9, exit 2. New `python3 scripts/nexusvi_native_evidence.py --self-test` passed one positive and six negative fixtures; `python3 scripts/nexusvi_native_evidence.py` executed the complete suite and validated all five records, with per-source SHA-256 and platform/renderer metadata. Python compilation passed. Blob verified against local test: 78b670165581ce18fd86e60b6bf08f7fed47cb63. Added a concise evidence matrix and CI artifact; remote CI pending. No game or physical GPU claim.

## ULTRA research follow-through: native Vulkan compute candidate

Original standalone C++17 control uses public Vulkan 1.0 headers, explicitly requires Khronos validation and debug utils, selects a software CPU device, creates a logical device, queue, coherent host-visible SSBO, descriptor set, compute pipeline and command buffer; uses host/compute barriers, fence and bounded wait. Verifies each word including untouched guards across 6 sizes and 20 repeats (120 planned dispatches per shader variant). On failed fence wait, exits process without destroying potentially in-flight resources. No real GPU, VRAM budget or runtime integration claim. Original GLSL shader and CI compile with glslang, validate with spirv-val, optimize with spirv-opt, validate again and reject bad magic, then execute both variants on Lavapipe. References: https://github.com/KhronosGroup/SPIRV-Tools ; https://github.com/KhronosGroup/Vulkan-ValidationLayers ; https://docs.vulkan.org/spec/latest/chapters/synchronization.html . No imported source. Local host fixture compiled with Debian GCC 14.2.0 C++17 -Wall -Wextra -Werror -fsanitize=undefined -O2, exit 0, 30842 checks; two source blobs verified. Vulkan loader -9, no ICD, headers or shader tools locally; full C++ Vulkan compilation, shader validation, debug callback and GPU execution are NOT verified locally. CI configuration added, remote result pending. Counts above are acceptance criteria, not measured Vulkan results.

## ULTRA cross-vendor independent Vulkan reproduction candidate

Catalog snapshot (PortWatch 2026-11-27T19:13:01.931Z): 45 effort records, 22 tool records, 30 candidates, 642 ignored, 6 flagged clusters. Read all effort and tool summaries, not all repository source. No copied implementation or access to removed upstream material. Catalog reports upstream Belobug removal on Nov 27; no attempt to retrieve removed material. Prior five-record GL regression re-executed locally and passed; Vulkan probe returned -9 again. Added explicit software/NVIDIA/AMD/Intel selection to original Vulkan fixture, no automatic hardware fallback, plus Windows/Linux Python build/reproduction runner. `python3 -m py_compile scripts/nexusvi_vk_runner.py` and `python3 scripts/nexusvi_vk_runner.py --self-test` passed (2 positive simulated report pairs, 17 negative); local source blob 91bbe6bb4912d9d495276e4ada4a00b8452aeafe. Actual runner collection failed closed on missing glslangValidator, full native build and execution pending. CI retains existing shader checks and adds runner software report. Hardware device type is driver reported, physical_gpu_verified always false. No retail game claim. See docs/nexusvi-vulkan-pc.md.
