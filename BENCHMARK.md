# Benchmark Report

This file summarizes the latest benchmark run for
`@mertcreates/mv3/no-execute-script-closure` in a human-readable format.

## Run Setup

- Date: 2026-02-15
- Command:

```bash
BENCH_SCALE=1 BENCH_WARMUP=2 BENCH_RUNS=5 npm run bench
```

- For every scenario, we measure two things:
- ESLint core overhead (rule disabled)
- ESLint + plugin rule (rule enabled)

The reported **Net Rule Cost** is:

`max(rule_enabled_time - eslint_core_overhead, 0)`

## What To Look At

- If you care about plugin impact, focus on **Net Rule Cost (median)**.
- `P95` values show occasional slow runs (jitter / GC / machine load).
- High message counts can increase runtime because ESLint has to materialize many diagnostics.

## Results (Latest)

| Scenario | Approx size | Rule enabled (median) | ESLint core (median) | Net Rule Cost (median) | Net Rule Cost (P95) | Avg diagnostics |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| `noise-baseline-5k` | 4,999 lines / 128.8 KB | 83.23 ms | 80.33 ms | **2.96 ms** | 29.97 ms | 0 |
| `massive-valid-inline` | 15,001 lines / 379.8 KB | 132.04 ms | 125.77 ms | **6.50 ms** | 69.51 ms | 0 |
| `massive-closure-captures` | 14,002 lines / 256.6 KB | 67.58 ms | 63.60 ms | **5.32 ms** | 6.26 ms | 1,400 |
| `alias-maze-resolution` | 15,003 lines / 258.7 KB | 91.03 ms | 83.41 ms | **4.62 ms** | 14.26 ms | 1,500 |
| `dynamic-apply-storm` | 4,002 lines / 283.3 KB | 71.42 ms | 64.69 ms | **7.98 ms** | 30.92 ms | 4,000 |
| `mixed-worst-case` | 30,006 lines / 537.4 KB | 156.27 ms | 140.08 ms | **16.19 ms** | 21.44 ms | 9,600 |

## Practical Takeaways

- On the 5k baseline file, plugin overhead is low: about **3 ms median**.
- In heavier real-world style stress (`mixed-worst-case`), net cost is still moderate: about **16 ms median**.
- Most total lint time is still ESLint core parsing/traversal, not plugin logic.

## Reproducing

Run:

```bash
npm run bench
```

Useful overrides:

- `BENCH_RUNS=10` for more stable medians
- `BENCH_WARMUP=3` to reduce cold-run noise
- `BENCH_SCALE=2` for larger synthetic files
- `BENCH_BASELINE_LINES=5000` to change baseline scenario size
