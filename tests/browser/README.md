# Argument transfer observations

On 2026-10-03, we recorded the original argument-transfer observations on macOS:

- Google Chrome **154.0.8037.93**, headless, unpacked MV3 service worker.
- Firefox **157.0**, headless, temporary MV3 extension with background scripts.

We added method, generator, world, and built-in argument probes on 2026-10-04
and ran them in Chrome **154.0.8037.93**. We could not start the Firefox fixture
for these cases, so `firefox-results.json` contains only the earlier observations.

Both browsers used disposable profiles and injected into the collector's local
HTTP page. The injected function returned the received value's type, object tag,
JSON representation, own keys and array element types. These observations measure
the received argument, rather than predicting it with `JSON.stringify` in the
extension context.

The raw results are [chrome-results.json](chrome-results.json) and
[firefox-results.json](firefox-results.json). Document IDs identify temporary pages.

## Reproduce

Start the collector:

```sh
python3 tests/browser/collect.py
```

It prints an output directory containing `chrome/` and `firefox/` extensions.
Create a separate browser profile for this run, then load the corresponding
extension directory:

- Chrome: load the unpacked extension through `chrome://extensions` in developer
  mode. For headless automation, launch with `--enable-unsafe-extension-debugging`
  and use CDP `Extensions.loadUnpacked` with the absolute extension path.
- Firefox: use `about:debugging` to load `firefox/manifest.json` as a temporary
  add-on, or use `web-ext run --source-dir <output>/firefox` with a disposable
  profile. The recorded run installed the add-on with Firefox's remote debugging
  `installTemporaryAddon` request.

The background script creates a local tab, runs the cases in order, and sends the
results to the collector. The result files record transferred values, function
reconstruction, and execution-world visibility. Inspect the results, note the
browser versions, close the disposable profiles, and stop the collector.

## Outcomes used by the rule

Both browsers reject a BigInt directly in `args`. Chrome omits nested BigInt
object fields and converts nested BigInt array elements to `null`; Firefox rejects
both. Chrome loses cyclic references; Firefox rejects cycles.

Both browsers omit object fields containing Function, Symbol or undefined and
convert these values in nested arrays to `null`. NaN and Infinity become `null`
in Firefox object fields; Chrome omits those fields. In nested arrays, both
browsers convert them to `null`. Directly in `args`, Chrome rejects Function,
Symbol, undefined, NaN and Infinity; Firefox converts them to `null`.

A repeated acyclic object reference preserves the data in both browsers. Date
becomes `{}` in Chrome, losing its timestamp, and an ISO string in Firefox;
neither browser delivers a `Date` object. The argument-loss rule reports known
Date values. Callers can pass an ISO string explicitly and reconstruct a `Date`
inside the injected function if they need its methods.

In the 2026-10-04 Chrome run, Map, Set, RegExp, URL, and URLSearchParams arrived
as plain objects with no built-in state. An object method and a method read from
a class instance each returned `null` and left the page state empty. A function
declaration returned the page title and updated the state. A generator returned
an empty result without running its body. The page-world sentinel was hidden
when `world` was omitted or set to `ISOLATED`, and visible with `MAIN`.

Chrome rejected `Uint8Array` and `ArrayBuffer` arguments with
`Unserializable argument passed.` Gecko's current implementation serializes the
argument array with `JSON.stringify`, so Firefox behavior for these new values
is inferred from that source path and standard JSON serialization; these cases
were not reproduced in Firefox during the 2026-10-04 run.

For the fixture's values, `JSON.stringify` produces `{}` for Map, Set, RegExp,
URLSearchParams, and ArrayBuffer. A URL's built-in `toJSON()` returns its href
string. `JSON.stringify(new Uint8Array([1, 2]))` produces the plain object
`{"0":1,"1":2}`. Its byte values remain, but it is no longer a typed array.
The earlier Firefox fixture did reproduce Date: it arrived as an ISO string.

The `optionResults` section checks optional null values. Both browsers accept null
for `func`, `files`, `args`, `world`, `allFrames`, `frameIds`, `documentIds`, and
`injectImmediately` as omission. The `false-func` counterexample fails in both
browsers. `empty.js` supplies a real injectable file for the `files` cases.
