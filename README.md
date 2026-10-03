# eslint-plugin-mv3

[![npm version](https://img.shields.io/npm/v/@mertcreates/eslint-plugin-mv3.svg)](https://www.npmjs.com/package/@mertcreates/eslint-plugin-mv3)
[![npm downloads](https://img.shields.io/npm/dm/@mertcreates/eslint-plugin-mv3.svg)](https://www.npmjs.com/package/@mertcreates/eslint-plugin-mv3)
[![license](https://img.shields.io/npm/l/@mertcreates/eslint-plugin-mv3.svg)](LICENSE.md)
[![CI](https://github.com/mertcreates/eslint-plugin-mv3/actions/workflows/ci.yml/badge.svg)](https://github.com/mertcreates/eslint-plugin-mv3/actions/workflows/ci.yml)

ESLint rules for Manifest V3 `scripting.executeScript` calls.

The plugin checks that injected functions use local variables and explicit inputs passed through `args`.

## Contents

- [The problem](#the-problem)
- [Features](#features)
- [Install](#install)
- [Usage (eslintrc)](#usage-eslintrc)
- [Usage (flat config)](#usage-flat-config)
- [Rules](#rules)
- [Options](#options)
- [Compatibility](#compatibility)
- [Benchmarks](#benchmarks)
- [License](#license)

## The problem

When using Manifest V3 `scripting.executeScript({ func })`, the injected
function is serialized and executed in the target page's execution world.
Each injected function needs its own variables or inputs passed through `args`.

If injected code references variables outside its own scope, it can fail at
runtime with `ReferenceError: ... is not defined`. This plugin catches those
closure traps statically at lint time.

## Features

- Detects closure capture inside `executeScript({ func })`
- Rejects imported/non-local `func` references
- Enforces `args: [...]` when injected functions have parameters
- Rejects dynamic/spread options that break static enforcement
- Supports `chrome` and `browser` hosts
- Supports alias/destructure/computed access, `.call`, `.apply`, `.bind`, `Reflect.apply`

## Install

```bash
npm i -D @mertcreates/eslint-plugin-mv3
# or
yarn add -D @mertcreates/eslint-plugin-mv3
# or
pnpm add -D @mertcreates/eslint-plugin-mv3
# or
bun add -D @mertcreates/eslint-plugin-mv3
```

## Usage (eslintrc)

Use this format with ESLint 8, or ESLint 9 with `ESLINT_USE_FLAT_CONFIG=false`.

```json
{
  "plugins": ["@mertcreates/mv3"],
  "rules": {
    "@mertcreates/mv3/no-execute-script-closure": "error"
  }
}
```

## Usage (flat config)

The recommended config uses flat config, which ESLint 10 requires.

```js
import mv3Plugin from '@mertcreates/eslint-plugin-mv3';

export default [
  mv3Plugin.configs.recommended,
];
```

## Rules

The recommended config enables this rule.

<a id="no-execute-script-closure"></a>

### `@mertcreates/mv3/no-execute-script-closure`

Validates that:

- `func` is local and resolvable in the same file
- `func` uses variables declared within the function or globals available in the target world
- `args` is present and array-literal when function parameters exist
- invocation/config shape stays statically analyzable

#### Examples

1. Closure capture (outer scope)

Incorrect:

```js
const TOP = 'outer';

function installBridge() {
  return TOP;
}

chrome.scripting.executeScript({
  target: { tabId: 1 },
  func: installBridge,
});
```

Correct:

```js
function installBridge(source) {
  return source;
}

chrome.scripting.executeScript({
  target: { tabId: 1 },
  func: installBridge,
  args: ['outer'],
});
```

1. Imported `func`

Incorrect:

```js
import { installBridge } from './bridge';

chrome.scripting.executeScript({
  target: { tabId: 1 },
  func: installBridge,
});
```

Correct:

```js
function installBridge(source) {
  return source;
}

chrome.scripting.executeScript({
  target: { tabId: 1 },
  func: installBridge,
  args: ['ok'],
});
```

1. Function inputs through `args`

Incorrect:

```js
function installBridge(config) {
  return config;
}

chrome.scripting.executeScript({
  target: { tabId: 1 },
  func: installBridge,
});
```

Correct:

```js
function installBridge(config) {
  return config;
}

chrome.scripting.executeScript({
  target: { tabId: 1 },
  func: installBridge,
  args: [{ source: 'mv3' }],
});
```

1. Dynamic/spread config

Incorrect:

```js
const baseOptions = { target: { tabId: 1 } };

chrome.scripting.executeScript({
  ...baseOptions,
  func: () => Date.now(),
});
```

Correct:

```js
chrome.scripting.executeScript({
  target: { tabId: 1 },
  func: () => Date.now(),
});
```

## Options

Enable the rule with `"error"` or `"warn"` without an options object.

## Compatibility

- ESLint: `>=8.50.0 <11`
- Node: versions supported by your ESLint runtime
- ESLint 10 requires Node `^20.19.0 || ^22.13.0 || >=24` and flat config.
- ESLint 10 also tracks JSX component references, allowing this rule to detect outer-scope components used by injected functions.

## Benchmarks

Benchmarks separate:

- ESLint core overhead
- Rule-on cost
- Net rule cost (`rule-on - overhead`)

Measured on 2026-02-15 with `BENCH_SCALE=1 BENCH_WARMUP=2 BENCH_RUNS=5`:

- `noise-baseline-5k`: net median rule cost ~`2.96ms`
- `mixed-worst-case` (30k lines): net median rule cost ~`16.19ms`

See details in [BENCHMARK.md](BENCHMARK.md).

## License

MIT.
