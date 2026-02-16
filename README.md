# eslint-plugin-mv3

[![npm version](https://img.shields.io/npm/v/@mertcreates/eslint-plugin-mv3.svg)](https://www.npmjs.com/package/@mertcreates/eslint-plugin-mv3)
[![npm downloads](https://img.shields.io/npm/dm/@mertcreates/eslint-plugin-mv3.svg)](https://www.npmjs.com/package/@mertcreates/eslint-plugin-mv3)
[![license](https://img.shields.io/npm/l/@mertcreates/eslint-plugin-mv3.svg)](LICENSE.md)
[![CI](https://github.com/mertcreates/eslint-plugin-mv3/actions/workflows/ci.yml/badge.svg)](https://github.com/mertcreates/eslint-plugin-mv3/actions/workflows/ci.yml)

ESLint rule(s) for MV3-safe `scripting.executeScript` usage.

It enforces that injected `func` code is self-contained, statically analyzable, and safe across Main World boundaries.

## Contents

- [The Problem](#the-problem)
- [Features](#features)
- [Install](#install)
- [Usage (eslintrc)](#usage-eslintrc)
- [Usage (flat config)](#usage-flat-config)
- [Rules](#rules)
- [Options](#options)
- [Compatibility](#compatibility)
- [Benchmarks](#benchmarks)
- [License](#license)

## The Problem

When using Manifest V3 `scripting.executeScript({ func })`, the injected
function is serialized and executed in Main World. Outer-scope values are not
carried with it.

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

```json
{
  "plugins": ["@mertcreates/mv3"],
  "rules": {
    "@mertcreates/mv3/no-execute-script-closure": "error"
  }
}
```

Or use recommended config:

```json
{
  "extends": ["plugin:@mertcreates/mv3/recommended"]
}
```

## Usage (flat config)

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
- `func` does not capture outer-scope variables
- `args` is present and array-literal when function parameters exist
- invocation/config shape stays statically analyzable

#### Incorrect / Correct by covered case

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

1. Params exist but `args` missing/invalid

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

No rule options right now. The rule is intentionally strict and zero-config.

## Compatibility

- ESLint: `>=8.50.0 <10`
- Node: versions supported by your ESLint runtime

## Benchmarks

Benchmarks separate:

- ESLint core overhead
- Rule-on cost
- Net rule cost (`rule-on - overhead`)

Latest run highlights (`BENCH_SCALE=1 BENCH_WARMUP=2 BENCH_RUNS=5`):

- `noise-baseline-5k`: net median rule cost ~`2.96ms`
- `mixed-worst-case` (30k lines): net median rule cost ~`16.19ms`

See details in [BENCHMARK.md](BENCHMARK.md).

## License

MIT.
