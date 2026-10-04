# Benchmark report

This benchmark measures how much lint time the plugin adds to ESLint. Each
scenario runs with all four rules enabled and again with the rules disabled.
The baseline includes ESLint parsing the file and walking its syntax tree.

## Measurement setup

- Date: 2026-10-04
- Machine: Apple M2, arm64 macOS
- Node: 22.22.2
- ESLint: 9.39.2
- Warmup: 2 runs; measurements: 6 runs per scenario

```sh
BENCH_SCALE=1 BENCH_WARMUP=2 BENCH_RUNS=6 npm run bench
```

For each run pair, the script calculates
`max(rules_enabled_time - baseline_time, 0)`. The "Added median" column is the
median of those per-run differences, so it may not equal the difference between
the two medians in the table.

## Results

| Scenario | Lines / KB | All rules median | Baseline median | Added median | Added P95 | Reports per lint run |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| `shared-payload` | 2003 / 89.9 | 26.25 ms | 19.09 ms | 6.80 ms | 8.69 ms | 0 |
| `shared-loss-payload` | 2003 / 89.9 | 26.19 ms | 17.86 ms | 8.27 ms | 8.90 ms | 2,000 |
| `noise-baseline-5k` | 4999 / 128.8 | 89.01 ms | 79.42 ms | 10.55 ms | 16.61 ms | 0 |
| `massive-valid-inline` | 15001 / 379.8 | 138.62 ms | 125.93 ms | 10.67 ms | 25.26 ms | 0 |
| `massive-closure-captures` | 14002 / 256.6 | 87.63 ms | 54.86 ms | 32.80 ms | 106.34 ms | 1,400 |
| `alias-maze-resolution` | 15003 / 258.7 | 104.83 ms | 78.02 ms | 29.32 ms | 133.23 ms | 1,500 |
| `dynamic-apply-storm` | 4002 / 283.3 | 66.42 ms | 53.10 ms | 12.75 ms | 15.87 ms | 4,000 |
| `mixed-worst-case` | 30006 / 537.4 | 173.25 ms | 118.14 ms | 43.80 ms | 121.32 ms | 8,400 |

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
will depend on its code and your machine. With six samples, the P95 column is
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
