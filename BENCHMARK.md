# Benchmark report

This benchmark measures how much lint time the plugin adds to ESLint. Each
scenario runs with all three rules enabled and again with the rules disabled.
The baseline includes ESLint parsing the file and walking its syntax tree.

## Measurement setup

- Date: 2026-10-03
- Machine: Apple M2, arm64 macOS
- Node: 22.22.2
- ESLint: 9.39.2
- Warmup: 2 runs; measurements: 5 runs per scenario

```sh
BENCH_SCALE=1 BENCH_WARMUP=2 BENCH_RUNS=5 npm run bench
```

For each measured pair, the script subtracts the baseline time from the time with
rules enabled and treats a negative difference as zero:
`max(rules_enabled_time - baseline_time, 0)`. The "Added median" column is the
median of these differences, so it can differ from subtracting the two time
medians in the table.

## Results

| Scenario | Lines / KB | All rules median | Baseline median | Added median | Added P95 | Reports per lint run |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| `shared-payload` | 2003 / 89.9 | 24.22 ms | 17.71 ms | 6.75 ms | 7.83 ms | 0 |
| `shared-loss-payload` | 2003 / 89.9 | 26.94 ms | 16.94 ms | 9.95 ms | 15.81 ms | 2,000 |
| `noise-baseline-5k` | 4999 / 128.8 | 88.33 ms | 76.56 ms | 11.77 ms | 76.23 ms | 0 |
| `massive-valid-inline` | 15001 / 379.8 | 158.16 ms | 121.00 ms | 35.68 ms | 49.10 ms | 0 |
| `massive-closure-captures` | 14002 / 256.6 | 98.10 ms | 71.08 ms | 27.02 ms | 33.78 ms | 1,400 |
| `alias-maze-resolution` | 15003 / 258.7 | 167.52 ms | 132.56 ms | 36.30 ms | 168.42 ms | 1,500 |
| `dynamic-apply-storm` | 4002 / 283.3 | 90.10 ms | 78.24 ms | 15.86 ms | 25.42 ms | 4,000 |
| `mixed-worst-case` | 30006 / 537.4 | 216.77 ms | 160.71 ms | 61.99 ms | 161.86 ms | 8,400 |

The shared payload cases each pass an array with 2,000 references to the same
object through 2,000 injection calls. The valid case has no reports. In the loss
case, the object contains a callback that both browsers drop; the rule reports
its first path once per injection. The rules reuse their analysis of the unchanged
payload across calls.

The remaining scenarios measure different kinds of code:

| Scenario | What it exercises |
| --- | --- |
| `noise-baseline-5k` | About 5,000 lines of code with no injection calls |
| `massive-valid-inline` | 1,500 valid injections with inline functions and arguments |
| `massive-closure-captures` | 1,400 injected functions that reference an outer variable |
| `alias-maze-resolution` | A chain of 1,500 API aliases, each used to inject a function with an outer reference |
| `dynamic-apply-storm` | 4,000 `.apply` and `Reflect.apply` calls whose argument lists the rules cannot resolve |
| `mixed-worst-case` | Aliases, spreads, imported functions, optional calls, and closure captures in one file |

A separate memory check used a 117-byte file that spreads a sparse array with an
entry at a billion-scale index. Linting completed in approximately 13 ms and used
about 12 MB of heap with a 192 MB heap limit. The regression test checks reports
for the empty entries and the value at the high index. The analysis stores these
positions without allocating an entry for every hole.

In `dynamic-apply-storm`, a call to `getArguments()` supplies the argument list,
so the closure rule reports `dynamicInvoke` for the unresolved call arguments.
The behavior tests also cover local argument lists that the rules can resolve.

These generated files help compare specific workloads. Timings in your project
will depend on its code and your machine. With five samples, the P95 column is
just the largest measured difference. Garbage collection and other work on the
machine can affect it.

## Reproduce

```sh
npm run bench
```

The default run uses two warmup runs and six measured runs per scenario. You can
adjust it with environment variables:

| Variable | Example | Effect |
| --- | --- | --- |
| `BENCH_RUNS` | `10` | Collect ten measurements per scenario |
| `BENCH_WARMUP` | `3` | Run each scenario three times before measuring |
| `BENCH_SCALE` | `2` | Double the generated call counts and noise code; keep the shared payload at 2,000 references |
| `BENCH_BASELINE_LINES` | `10000` | Set the noise scenario to about 10,000 lines before applying the scale |
