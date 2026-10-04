/* global URL, URLSearchParams, document */

const api = globalThis.browser ?? globalThis.chrome;
const cycle = {};
cycle.self = cycle;
const shared = { ok: true };
const sparse = [];
sparse[1] = 1;
const cases = [
  ['plain', { name: 'mv3', values: [1, true, null] }],
  ['bigint', 1n],
  ['object-bigint', { value: 1n }],
  ['array-bigint', [1n]],
  ['array-cycle', [cycle]],
  ['cycle', cycle],
  ['function', () => 1],
  ['symbol', Symbol('test')],
  ['undefined', undefined],
  ['nan', NaN],
  ['infinity', Infinity],
  ['object-loss', { callback() {}, missing: undefined, symbol: Symbol('test'), number: NaN }],
  ['sparse', sparse],
  ['array-loss', [() => 1, undefined, Symbol('test'), NaN, Infinity]],
  ['date', new Date('2026-01-01T00:00:00Z')],
  ['shared', [shared, shared]],
  ['map', new Map([['key', 'value']])],
  ['set', new Set(['value'])],
  ['regexp-literal', /title/gi],
  ['regexp-constructor', new RegExp('title', 'gi')],
  ['url', new URL('https://example.com/path?q=mv3')],
  ['url-search-params', new URLSearchParams('q=mv3')],
  ['uint8-array', new Uint8Array([1, 2])],
  ['array-buffer', new Uint8Array([1, 2]).buffer],
];

(async () => {
  const tab = await api.tabs.create({ url: 'http://127.0.0.1:8799/target' });
  await new Promise((resolve) => setTimeout(resolve, 1000));
  const results = [];
  for (const [name, value] of cases) {
    try {
      const response = await api.scripting.executeScript({
        target: { tabId: tab.id },
        func: (input) => ({
          type: typeof input,
          tag: Object.prototype.toString.call(input),
          json: JSON.stringify(input),
          keys: input && typeof input === 'object' ? Object.keys(input) : null,
          arrayTypes: Array.isArray(input) ? input.map((item) => typeof item) : null,
          nan: Number.isNaN(input),
          infinity: input === Infinity || input === -Infinity,
        }),
        args: [value],
      });
      results.push({ name, response });
    } catch (error) {
      results.push({ name, error: String(error) });
    }
  }
  const optionResults = [];
  const optionCases = [
    ['null-func', { func: null, files: ['empty.js'] }],
    ['null-files', { files: null, func: () => 42 }],
    ['null-args', { args: null, func: () => 42 }],
    ['null-world', { world: null, func: () => 42 }],
    ['null-allFrames', { target: { tabId: tab.id, allFrames: null, frameIds: [0] }, func: () => 42 }],
    ['null-frameIds', { target: { tabId: tab.id, frameIds: null }, func: () => 42 }],
    ['null-documentIds', { target: { tabId: tab.id, documentIds: null }, func: () => 42 }],
    ['null-injectImmediately', { injectImmediately: null, func: () => 42 }],
    ['false-func', { func: false, files: ['empty.js'] }],
  ];
  for (const [name, options] of optionCases) {
    try {
      const response = await api.scripting.executeScript({ target: { tabId: tab.id }, ...options });
      optionResults.push({ name, response });
    } catch (error) {
      optionResults.push({ name, error: String(error) });
    }
  }
  const methodActions = {
    readTitle() {
      document.documentElement.dataset.method = 'ran';
      return document.title;
    },
  };
  class Actions {
    readTitle() {
      document.documentElement.dataset.classMethod = 'ran';
      return document.title;
    }
  }
  function readTitle() {
    document.documentElement.dataset.declaration = 'ran';
    return document.title;
  }
  function* readTitleGenerator() {
    document.documentElement.dataset.generator = 'ran';
    yield document.title;
  }
  const functionCases = [
    ['method', methodActions.readTitle],
    ['class-method', new Actions().readTitle],
    ['declaration', readTitle],
    ['generator', readTitleGenerator],
  ];
  const functionResults = [];
  for (const [name, func] of functionCases) {
    try {
      const response = await api.scripting.executeScript({ target: { tabId: tab.id }, func });
      const state = await api.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => ({ ...document.documentElement.dataset }),
      });
      functionResults.push({ name, response, state });
    } catch (error) {
      functionResults.push({ name, error: String(error) });
    }
  }
  const worldResults = [];
  for (const world of [undefined, 'ISOLATED', 'MAIN']) {
    try {
      const response = await api.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => globalThis.__mv3PageSentinel ?? null,
        ...(world ? { world } : {}),
      });
      worldResults.push({ world: world ?? 'omitted', response });
    } catch (error) {
      worldResults.push({ world: world ?? 'omitted', error: String(error) });
    }
  }
  await fetch('http://127.0.0.1:8799/results', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userAgent: navigator.userAgent, results, optionResults, functionResults, worldResults }),
  });
})().catch((error) => console.error(error));
