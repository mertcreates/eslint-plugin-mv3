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

The recommended config enables `no-execute-script-closure`. The options,
argument-transfer, and MAIN-world policy rules are opt-in; see the
[configuration below](#opt-in-injection-checks). Each rule accepts `"error"` or
`"warn"` and takes no options.

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

These three rules are opt-in. Add any of them alongside the recommended config:

```js
import mv3Plugin from '@mertcreates/eslint-plugin-mv3';

export default [
  mv3Plugin.configs.recommended,
  {
    rules: {
      '@mertcreates/mv3/valid-execute-script-options': 'error',
      '@mertcreates/mv3/no-execute-script-argument-loss': 'error',
      '@mertcreates/mv3/no-main-world': 'error',
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
- Pass a function declaration, function expression, or arrow function that can be
  reconstructed as a standalone function. Object and class method shorthand
  cannot.
- Do not pass a generator function: `executeScript` calls it but does not advance
  the iterator, so its body does not run.
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

#### Passing a method or generator

`func` is serialized and reconstructed as a standalone function. A method such
as `readTitle() {}` stringifies to method syntax, which cannot be used as a
standalone function expression. Define it as a declaration, function expression,
or arrow function instead. [MDN documents this serialization failure and the
different error reporting in Firefox and Chrome.](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/scripting/executeScript)

```js
const actions = {
  readTitle() {
    return document.title;
  },
};

chrome.scripting.executeScript({
  target: { tabId: 1 },
  func: actions.readTitle, // reported
});

function readTitle() {
  return document.title;
}

chrome.scripting.executeScript({
  target: { tabId: 1 },
  func: readTitle,
});
```

A generator function is callable, but calling it only creates an iterator. Since
`executeScript` does not call `.next()`, the generator body never runs:

```js
function* readTitle() {
  yield document.title;
}

chrome.scripting.executeScript({
  target: { tabId: 1 },
  func: readTitle, // reported
});
```

Analysis stops at methods on constructed class instances. For those member
expressions, the closure rule reports an unresolved function because it cannot
identify the runtime object or prototype.

<a id="no-main-world"></a>

### `@mertcreates/mv3/no-main-world`

Enable this rule when the project requires injected code to stay in the isolated
world. `world: 'MAIN'` is a supported feature and can be necessary when injected
code must use JavaScript values created by the page. Page scripts and injected
code share a JavaScript world in `MAIN`, so page scripts can change shared
globals and page-defined values that the injected code uses. `ISOLATED` runs in
a separate JavaScript environment. Chrome and Firefox also default an omitted
`world` to `ISOLATED`. See the
[Chrome `scripting` reference](https://developer.chrome.com/docs/extensions/reference/api/scripting)
and [MDN `ExecutionWorld`](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/scripting/ExecutionWorld)
for the documented isolation boundary.

The rule reports statically resolved `world: 'MAIN'` values on
`chrome.scripting.executeScript` and `browser.scripting.executeScript` calls. It
accepts an omitted world or explicit `ISOLATED`, and ignores dynamic or unknown
values.

```js
chrome.scripting.executeScript({
  target: { tabId: 1 },
  world: 'MAIN', // reported when the rule is enabled
  func: () => document.title,
});
```

<a id="no-execute-script-argument-loss"></a>

### `@mertcreates/mv3/no-execute-script-argument-loss`

Checks `args` for values that cause rejection or data loss in Chrome or Firefox.
Each message includes the path to the value, such as `args[0].settings.callback`.
The earlier cross-browser cases below were run in Chrome 154 and Firefox 157.
We ran the additional built-in cases in Chrome 154. We could not run the Firefox
fixture for those cases, so their Firefox outcomes are inferred from MDN's
JSON-serializable argument requirement and Gecko's current
`JSON.stringify(args)` implementation. See
[Chrome's API reference](https://developer.chrome.com/docs/extensions/reference/api/scripting#method-executeScript)
and [MDN's `executeScript()` reference](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/scripting/executeScript).

| Value and position | Chrome 154 | Firefox 157 |
| --- | --- | --- |
| BigInt directly in `args` | Rejects | Rejects |
| Function, Symbol, undefined, NaN, Infinity directly in `args` | Rejects | Converts to `null` |
| Function, Symbol, undefined in an object field | Omits field | Omits field |
| NaN, Infinity in an object field | Omits field | Converts to `null` |
| Function, Symbol, undefined, NaN, Infinity in a nested array | Converts to `null` | Converts to `null` |
| BigInt in an object field or nested array | Omits field or converts element to `null` | Rejects |
| Circular reference | Loses circular reference | Rejects |
| Date | Becomes an empty object; timestamp is lost | Becomes an ISO string, not a `Date` |
| Map, Set, RegExp, URLSearchParams | Serializes as a plain object; built-in data is lost | `JSON.stringify` produces `{}`; built-in data is lost |
| URL | Serializes as a plain object | Calls `URL.toJSON()` and serializes the href as a string |
| Uint8Array | Rejects as unserializable | `JSON.stringify` produces a plain object with numeric index keys (for example, `{"0":1,"1":2}`); typed-array identity is lost |
| ArrayBuffer | Rejects as unserializable | `JSON.stringify` produces `{}`; buffer bytes are lost |

In the Chrome fixture, an object method and a method read from a class instance
each returned `null` and left the page state empty. A function declaration
returned the page title and updated the state. A generator returned an empty
object without running its body. The page-world sentinel was visible with `MAIN`
and hidden when `world` was omitted or set to `ISOLATED`.

A rejected argument prevents injection. A dropped field or a value converted to
`null` changes what the injected function receives. The diagnostics describe
these browser-specific outcomes.

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

The rule accepts JSON values and repeated references to an object, as long as
the object graph has no cycles. It reports `Date` because Chrome 154 drops its
timestamp and Firefox 157 turns it into an ISO string. Neither browser passes a
`Date` object to the injected function. Pass an ISO string explicitly. If the
injected code needs Date methods, construct a `Date` there. The rule also
reports Map, Set, RegExp, URL, URLSearchParams, Uint8Array, and ArrayBuffer
because their extension API transfer does not preserve the built-in value as a
usable page-side object. Fix invalid option combinations first. The rule skips
argument transfer checks for those calls until the options are valid.

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

The argument rule recognizes direct and locally aliased global constructors for
Date, Map, Set, RegExp, URL, URLSearchParams, Uint8Array, and ArrayBuffer, plus
regular expression literals. It does not follow imported constructors,
constructed class instances, cross-file prototype changes, or unknown
constructor results. Statically assigned serializers and values that escape to
unknown code remain uncertain.

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

The benchmark compares lint time with all four rules enabled against ESLint with
the rules disabled. It covers large files and a shared payload reused across
2,000 injection calls.

See the timings, measurement method, and commands in
[BENCHMARK.md](https://github.com/mertcreates/eslint-plugin-mv3/blob/main/BENCHMARK.md).

## License

MIT.
