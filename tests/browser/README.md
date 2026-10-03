# Argument transfer observations

Recorded on macOS on 2026-10-03:

- Google Chrome **154.0.8037.93**, headless, unpacked MV3 service worker.
- Firefox **157.0**, headless, temporary MV3 extension with background scripts.

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

The background script creates a local tab, runs the cases sequentially and sends
its observations to the collector. Inspect both results files, record the browser
versions, close the disposable profiles, and stop the collector.

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
becomes `{}` in Chrome and an ISO string in Firefox. The rule accepts Date as a
platform conversion; callers needing a common representation can pass an explicit
ISO string.

The `optionResults` section checks optional null values. Both browsers accept null
for `func`, `files`, `args`, `world`, `allFrames`, `frameIds`, `documentIds`, and
`injectImmediately` as omission. The `false-func` counterexample fails in both
browsers. `empty.js` supplies a real injectable file for the `files` cases.
