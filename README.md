# eslint-plugin-mv3

[![npm version](https://img.shields.io/npm/v/@mertcreates/eslint-plugin-mv3.svg)](https://www.npmjs.com/package/@mertcreates/eslint-plugin-mv3)
[![npm downloads](https://img.shields.io/npm/dm/@mertcreates/eslint-plugin-mv3.svg)](https://www.npmjs.com/package/@mertcreates/eslint-plugin-mv3)
[![license](https://img.shields.io/npm/l/@mertcreates/eslint-plugin-mv3.svg)](LICENSE.md)
[![CI](https://github.com/mertcreates/eslint-plugin-mv3/actions/workflows/ci.yml/badge.svg)](https://github.com/mertcreates/eslint-plugin-mv3/actions/workflows/ci.yml)

ESLint rules for Manifest V3 `scripting.executeScript` calls.

Catch references that an injected function cannot access, invalid injection options,
and arguments that Chrome or Firefox reject or change during transfer.

## Contents

- [The problem](#the-problem)
- [Supported calls](#supported-calls)
- [Install](#install)
- [Usage (eslintrc)](#usage-eslintrc)
- [Usage (flat config)](#usage-flat-config)
- [Rules](#rules)
- [Opt-in injection checks](#opt-in-injection-checks)
- [Analysis limits](#analysis-limits)
- [Compatibility](#compatibility)
- [Benchmarks](#benchmarks)
- [License](#license)

## The problem

Chrome and Firefox copy the function you pass to `scripting.executeScript({ func })`
and run it in the target page's execution world. The function can use variables it
declares itself, globals available in that world, and inputs you pass through `args`.

Variables from the surrounding extension code do not travel with the function.
Referencing one can cause `ReferenceError: ... is not defined` in the page.
The closure rule reports these references when you lint your code.

## Supported calls

The rules recognize `chrome.scripting.executeScript` and
`browser.scripting.executeScript`. They follow aliases, destructuring, and known
computed property names, including calls through `.call`, `.apply`, `.bind`, and
`Reflect.apply`.

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

This example works with ESLint 8.50+, 9, and 10. ESLint 10 requires flat config.

```js
import mv3Plugin from '@mertcreates/eslint-plugin-mv3';

export default [
  mv3Plugin.configs.recommended,
];
```

## Rules

The recommended config enables `no-execute-script-closure`. Enable the options
and argument transfer rules explicitly with the [configuration below](#opt-in-injection-checks).
Each rule accepts `"error"` or `"warn"` and takes no options.

<a id="no-execute-script-closure"></a>

### `@mertcreates/mv3/no-execute-script-closure`

Checks that:

- The rule can find the `func` definition in the same file
- The function uses its own variables or globals available in the target world
- `args` is present and the rule can resolve it to an array when the function has parameters
- The rule can resolve the call and its options from the source code

#### Examples

##### Passing a value from the surrounding scope

This function tries to read a heading using `selector` from the extension code.
The injected copy cannot access that variable:

```js
const selector = 'h1';

function readHeading() {
  return document.querySelector(selector)?.textContent;
}

chrome.scripting.executeScript({
  target: { tabId: 1 },
  func: readHeading,
});
```

Pass the selector through `args` so the injected function receives it as a parameter:

```js
const selector = 'h1';

function readHeading(selector) {
  return document.querySelector(selector)?.textContent;
}

chrome.scripting.executeScript({
  target: { tabId: 1 },
  func: readHeading,
  args: [selector],
});
```

##### Defining the injected function in the same file

The rule cannot check the body of an imported function for outer references:

```js
import { readPageTitle } from './page.js';

chrome.scripting.executeScript({
  target: { tabId: 1 },
  func: readPageTitle,
});
```

Define the function locally so the rule can check it:

```js
function readPageTitle() {
  return document.title;
}

chrome.scripting.executeScript({
  target: { tabId: 1 },
  func: readPageTitle,
});
```

##### Passing function inputs through `args`

This function needs a color, but the call supplies no arguments:

```js
function highlightHeading(color) {
  const heading = document.querySelector('h1');
  if (heading) heading.style.backgroundColor = color;
}

chrome.scripting.executeScript({
  target: { tabId: 1 },
  func: highlightHeading,
});
```

Supply the color in `args`. Its first entry becomes the function's first parameter:

```js
function highlightHeading(color) {
  const heading = document.querySelector('h1');
  if (heading) heading.style.backgroundColor = color;
}

chrome.scripting.executeScript({
  target: { tabId: 1 },
  func: highlightHeading,
  args: ['yellow'],
});
```

##### Using a local options object

You can store options in local variables and use spreads whose values the rule can resolve:

```js
const baseOptions = { target: { tabId: 1 } };
const options = { ...baseOptions, func: () => Date.now() };
chrome.scripting.executeScript(options);
```

### Opt-in injection checks

These two rules are opt-in. Add either or both alongside the recommended config:

```js
import mv3Plugin from '@mertcreates/eslint-plugin-mv3';

export default [
  mv3Plugin.configs.recommended,
  {
    rules: {
      '@mertcreates/mv3/valid-execute-script-options': 'error',
      '@mertcreates/mv3/no-execute-script-argument-loss': 'error',
    },
  },
];
```

<a id="valid-execute-script-options"></a>

### `@mertcreates/mv3/valid-execute-script-options`

Reports invalid `executeScript` options when it can determine the values:

- Provide exactly one of `func` or `files`.
- Use `args` with `func`.
- Provide `target` and `target.tabId`.
- Use valid types for `func`, `files`, `args`, `world`, `injectImmediately`, and target fields.
- Set `world` to `ISOLATED` or `MAIN`.
- Choose `allFrames: true` or `frameIds`.
- Choose `documentIds` or `frameIds`.

The rule reports a missing field only when it can resolve the part of the object
where that field belongs. Chrome and Firefox treat optional fields set to `null`
or `undefined` as omitted.

#### Choosing a function or a file

This call supplies both sources, so the browser cannot accept it:

```js
chrome.scripting.executeScript({
  target: { tabId: 1 },
  func: () => document.title,
  files: ['read-page-title.js'],
});
```

To inject the function, provide `func`:

```js
chrome.scripting.executeScript({
  target: { tabId: 1 },
  func: () => document.title,
});
```

To inject the file, provide `files`:

```js
chrome.scripting.executeScript({
  target: { tabId: 1 },
  files: ['read-page-title.js'],
});
```

#### Choosing which frames to target

This call requests all frames and a specific frame at the same time:

```js
chrome.scripting.executeScript({
  target: { tabId: 1, allFrames: true, frameIds: [0] },
  func: () => document.title,
});
```

Use `frameIds` with `allFrames: false` to read the title from frame `0` (the main frame):

```js
chrome.scripting.executeScript({
  target: { tabId: 1, allFrames: false, frameIds: [0] },
  func: () => document.title,
});
```

`allFrames: true` can accompany `documentIds`. This example assumes you have a
valid document ID for the target tab:

```js
chrome.scripting.executeScript({
  target: { tabId: 1, allFrames: true, documentIds: ['document-id'] },
  files: ['read-page-title.js'],
});
```

<a id="no-execute-script-argument-loss"></a>

### `@mertcreates/mv3/no-execute-script-argument-loss`

Checks `args` for values that cause rejection or data loss in both tested browsers.
Each message includes the path to the value, such as `args[0].settings.callback`.
The outcomes below come from calls in Chrome 154 and Firefox 157.

| Value and position | Chrome 154 | Firefox 157 |
| --- | --- | --- |
| BigInt directly in `args` | Rejects | Rejects |
| Function, Symbol, undefined, NaN, Infinity directly in `args` | Rejects | Converts to `null` |
| Function, Symbol, undefined in an object field | Omits field | Omits field |
| NaN, Infinity in an object field | Omits field | Converts to `null` |
| Function, Symbol, undefined, NaN, Infinity in a nested array | Converts to `null` | Converts to `null` |
| BigInt in an object field or nested array | Omits field or converts element to `null` | Rejects |
| Circular reference | Loses circular reference | Rejects |

When a browser rejects an argument, the injection fails. When it drops a field or
converts a value to `null`, the injected function receives changed data. The rule's
message describes what each tested browser does.

#### A callback field disappears during transfer

This function expects a callback in `settings`, but both browsers drop the
`formatTitle` field. The injected function then tries to call a missing function.
The rule reports `args[0].formatTitle`:

```js
chrome.scripting.executeScript({
  target: { tabId: 1 },
  func: (settings) => settings.formatTitle(document.title),
  args: [{ formatTitle: (title) => title.trim() }],
});
```

Define the formatting function inside the injected function to read and trim the
same page title:

```js
chrome.scripting.executeScript({
  target: { tabId: 1 },
  func: () => {
    const formatTitle = (title) => title.trim();
    return formatTitle(document.title);
  },
});
```

#### A BigInt argument prevents injection

This call tries to store a record ID on the page, but both browsers reject the
BigInt at `args[0]`. The injected function never runs:

```js
chrome.scripting.executeScript({
  target: { tabId: 1 },
  func: (recordId) => {
    document.documentElement.dataset.recordId = recordId;
  },
  args: [9007199254740993n],
});
```

Pass the ID as a decimal string. This preserves every digit and works with the
page's string-valued `dataset`:

```js
chrome.scripting.executeScript({
  target: { tabId: 1 },
  func: (recordId) => {
    document.documentElement.dataset.recordId = recordId;
  },
  args: ['9007199254740993'],
});
```

The rule accepts JSON values and repeated references to an object that has no
circular references. It also accepts `Date`. Chrome 154 converts a date to `{}`;
Firefox 157 converts it to an ISO string. Pass a date as a string when the
receiving code needs the same value in both browsers.
Fix invalid options combinations first. The rule skips argument transfer checks
for those calls until the options are valid.

Browser fixtures, raw observations, and reproduction instructions are in
[tests/browser](https://github.com/mertcreates/eslint-plugin-mv3/tree/main/tests/browser).

### Analysis limits

The analysis uses source code only. The rules read its syntax tree and variable
scopes. They resolve literal values, local aliases, known computed property names
and spreads, and local property assignments they can follow in order. Each call uses the values known
at that point, so later assignments do not affect earlier calls.

A value becomes uncertain when, for example, you pass its object to a function the
rules cannot inspect, use a getter or custom `toJSON`, or change it through control
flow the rules cannot follow. Objects captured by functions that may run later
are also uncertain if their contents can change. Serialization hooks can make
values uncertain for later calls too.

The options and argument transfer rules report only problems they can prove.
The closure rule reports `dynamicConfig` when it cannot resolve the options.
The rules follow variable bindings to distinguish the browser APIs from local
objects named `chrome` or `browser`, and to account for reassigned API aliases.

## Compatibility

- ESLint: `>=8.50.0 <11`
- Node: versions supported by your ESLint runtime
- ESLint 10 requires Node `^20.19.0 || ^22.13.0 || >=24` and flat config.
- With ESLint 10, the closure rule also detects JSX components referenced from outside the injected function.

## Benchmarks

The benchmark compares lint time with all three rules enabled against ESLint with
the rules disabled. It covers large files and a shared payload reused across
2,000 injection calls.

See the timings, measurement method, and commands in
[BENCHMARK.md](https://github.com/mertcreates/eslint-plugin-mv3/blob/main/BENCHMARK.md).

## License

MIT.
