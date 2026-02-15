import { ESLint } from 'eslint';

import rule from '../rules/no-execute-script-closure.js';

const RULE_ID = '@mertcreates/mv3/no-execute-script-closure';

const parsePositiveInt = (value, fallback) => {
  const parsed = Number.parseInt(value ?? '', 10);

  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const SCALE = parsePositiveInt(process.env.BENCH_SCALE, 1);
const WARMUP_RUNS = parsePositiveInt(process.env.BENCH_WARMUP, 2);
const MEASURED_RUNS = parsePositiveInt(process.env.BENCH_RUNS, 6);
const BASELINE_LINES = parsePositiveInt(process.env.BENCH_BASELINE_LINES, 5_000);
const BASELINE_NOISE_COUNT = Math.max(1, Math.floor((BASELINE_LINES - 1) / 2));

const createLinter = ({ enableRule }) => {
  const config = {
    languageOptions: {
      ecmaVersion: 2020,
      sourceType: 'module',
    },
    rules: {},
  };

  if (enableRule) {
    config.plugins = {
      '@mertcreates/mv3': {
        rules: {
          'no-execute-script-closure': rule,
        },
      },
    };
    config.rules[RULE_ID] = 'error';
  }

  return new ESLint({
    overrideConfigFile: true,
    overrideConfig: [config],
  });
};

const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);

  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1] + sorted[mid]) / 2;
  }

  return sorted[mid];
};

const percentile = (values, p) => {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));

  return sorted[idx];
};

const mean = (values) => (values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length);

const ms = (startNs, endNs) => Number(endNs - startNs) / 1_000_000;

const makeNoiseScenario = (count) => {
  const lines = ['function noop(a, b) { return a + b; }'];

  for (let i = 0; i < count; i += 1) {
    lines.push(`const n${i} = noop(${i}, ${i + 1});`);
    lines.push(`Math.max(n${i}, ${i});`);
  }

  return lines.join('\n');
};

const makeMassiveValidScenario = (count) => {
  const lines = ['const tabId = 1;'];

  for (let i = 0; i < count; i += 1) {
    lines.push(`
      chrome.scripting.executeScript({
        target: { tabId },
        func: (cfg) => {
          const payload = { source: cfg.source, seq: ${i} };
          window.postMessage(payload, '*');
        },
        args: [{ source: 'bench' }],
      });
    `);
  }

  return lines.join('\n');
};

const makeMassiveClosureScenario = (count) => {
  const lines = ['const OUTER = "bench";', 'const tabId = 1;'];

  for (let i = 0; i < count; i += 1) {
    lines.push(`
      function installBridge${i}() {
        return OUTER + ${i};
      }

      chrome.scripting.executeScript({
        target: { tabId },
        func: installBridge${i},
      });
    `);
  }

  return lines.join('\n');
};

const makeAliasMazeScenario = (count) => {
  const lines = ['const tabId = 1;', 'const TOP = "outer";', 'const base = chrome.scripting.executeScript;'];

  for (let i = 0; i < count; i += 1) {
    const prev = i === 0 ? 'base' : `alias${i - 1}`;
    lines.push(`const alias${i} = ${prev};`);
  }

  for (let i = 0; i < count; i += 1) {
    lines.push(`
      function bridge${i}() {
        return TOP + ${i};
      }
      alias${i}({
        target: { tabId },
        func: bridge${i},
      });
    `);
  }

  return lines.join('\n');
};

const makeDynamicApplyScenario = (count) => {
  const lines = ['const tabId = 1;', 'const invokeArgs = [{ target: { tabId }, func: () => Date.now() }];'];

  for (let i = 0; i < count; i += 1) {
    lines.push('chrome.scripting.executeScript.apply(chrome.scripting, invokeArgs);');
    lines.push('Reflect.apply(chrome.scripting.executeScript, chrome.scripting, invokeArgs);');
  }

  return lines.join('\n');
};

const makeMixedWorstCaseScenario = (count) => {
  const lines = [
    'import { injectedFunc } from "./external.js";',
    'const tabId = 1;',
    'const TOP = "outer";',
    'const execute = chrome.scripting.executeScript;',
    'const wrapper = { executeScript: chrome.scripting.executeScript };',
    'const options = { target: { tabId } };',
  ];

  for (let i = 0; i < count; i += 1) {
    lines.push(`
      function local${i}(cfg) {
        return cfg.source + TOP + ${i};
      }

      execute({
        ...options,
        func: local${i},
      });

      wrapper.executeScript({
        target: { tabId },
        func: injectedFunc,
      });

      chrome?.scripting?.executeScript?.({
        target: { tabId },
        func: local${i},
      });

      browser.scripting.executeScript({
        target: { tabId },
        func: local${i},
      });
    `);
  }

  return lines.join('\n');
};

const scenarios = [
  {
    name: 'noise-baseline-5k',
    build: () => makeNoiseScenario(BASELINE_NOISE_COUNT * SCALE),
  },
  {
    name: 'massive-valid-inline',
    build: () => makeMassiveValidScenario(1_500 * SCALE),
  },
  {
    name: 'massive-closure-captures',
    build: () => makeMassiveClosureScenario(1_400 * SCALE),
  },
  {
    name: 'alias-maze-resolution',
    build: () => makeAliasMazeScenario(1_500 * SCALE),
  },
  {
    name: 'dynamic-apply-storm',
    build: () => makeDynamicApplyScenario(2_000 * SCALE),
  },
  {
    name: 'mixed-worst-case',
    build: () => makeMixedWorstCaseScenario(1_200 * SCALE),
  },
];

const lintWithTiming = async (linter, code, filePath) => {
  const start = process.hrtime.bigint();
  const [result] = await linter.lintText(code, { filePath });
  const end = process.hrtime.bigint();

  return { durationMs: ms(start, end), result };
};

const runScenario = async (ruleLinter, baselineLinter, scenario) => {
  const code = scenario.build();
  const ruleTimings = [];
  const baselineTimings = [];
  const netTimings = [];
  let totalMessages = 0;
  let totalRuleHeapDelta = 0;
  let totalBaselineHeapDelta = 0;

  for (let i = 0; i < WARMUP_RUNS; i += 1) {
    await lintWithTiming(baselineLinter, code, `${scenario.name}.baseline.warmup.js`);
    await lintWithTiming(ruleLinter, code, `${scenario.name}.rule.warmup.js`);
  }

  for (let i = 0; i < MEASURED_RUNS; i += 1) {
    global.gc?.();

    const baselineHeapBefore = process.memoryUsage().heapUsed;
    const baseline = await lintWithTiming(baselineLinter, code, `${scenario.name}.baseline.${i}.js`);
    const baselineHeapAfter = process.memoryUsage().heapUsed;

    const ruleHeapBefore = process.memoryUsage().heapUsed;
    const ruleRun = await lintWithTiming(ruleLinter, code, `${scenario.name}.rule.${i}.js`);
    const ruleHeapAfter = process.memoryUsage().heapUsed;

    const messages = ruleRun.result.messages.filter((message) => message.ruleId === RULE_ID);

    baselineTimings.push(baseline.durationMs);
    ruleTimings.push(ruleRun.durationMs);
    netTimings.push(Math.max(ruleRun.durationMs - baseline.durationMs, 0));
    totalMessages += messages.length;
    totalBaselineHeapDelta += baselineHeapAfter - baselineHeapBefore;
    totalRuleHeapDelta += ruleHeapAfter - ruleHeapBefore;
  }

  return {
    name: scenario.name,
    bytes: Buffer.byteLength(code, 'utf8'),
    lines: code.split('\n').length,
    ruleMedianMs: median(ruleTimings),
    ruleP95Ms: percentile(ruleTimings, 95),
    ruleMeanMs: mean(ruleTimings),
    overheadMedianMs: median(baselineTimings),
    overheadP95Ms: percentile(baselineTimings, 95),
    overheadMeanMs: mean(baselineTimings),
    netMedianMs: median(netTimings),
    netP95Ms: percentile(netTimings, 95),
    netMeanMs: mean(netTimings),
    meanRuleHeapDeltaMb: totalRuleHeapDelta / MEASURED_RUNS / (1024 * 1024),
    meanOverheadHeapDeltaMb: totalBaselineHeapDelta / MEASURED_RUNS / (1024 * 1024),
    avgMessages: totalMessages / MEASURED_RUNS,
  };
};

const printHeader = () => {
  console.log('MV3 Rule Benchmark');
  console.log(
    `scale=${SCALE} warmup=${WARMUP_RUNS} runs=${MEASURED_RUNS} baselineLines=${BASELINE_LINES} (rule-on / eslint-overhead / net-rule-cost)`
  );
  console.log('');
};

const printResults = (results) => {
  const headers = [
    'scenario',
    'lines',
    'size(kb)',
    'ruleMedian(ms)',
    'overheadMedian(ms)',
    'netMedian(ms)',
    'ruleP95(ms)',
    'overheadP95(ms)',
    'netP95(ms)',
    'avgMessages',
  ];

  console.log(headers.join('\t'));
  for (const row of results) {
    console.log(
      [
        row.name,
        row.lines,
        (row.bytes / 1024).toFixed(1),
        row.ruleMedianMs.toFixed(2),
        row.overheadMedianMs.toFixed(2),
        row.netMedianMs.toFixed(2),
        row.ruleP95Ms.toFixed(2),
        row.overheadP95Ms.toFixed(2),
        row.netP95Ms.toFixed(2),
        row.avgMessages.toFixed(1),
      ].join('\t')
    );
  }
};

const main = async () => {
  const ruleLinter = createLinter({ enableRule: true });
  const baselineLinter = createLinter({ enableRule: false });
  const results = [];

  printHeader();

  for (const scenario of scenarios) {
    const result = await runScenario(ruleLinter, baselineLinter, scenario);
    results.push(result);
    console.log(
      `[done] ${result.name} ruleMedian=${result.ruleMedianMs.toFixed(2)}ms overheadMedian=${result.overheadMedianMs.toFixed(2)}ms netMedian=${result.netMedianMs.toFixed(2)}ms lines=${result.lines}`
    );
  }

  console.log('');
  printResults(results);
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
