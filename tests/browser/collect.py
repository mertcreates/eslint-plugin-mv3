"""Collect executeScript observations from disposable MV3 browser fixtures."""
import argparse
import http.server
import json
import pathlib
import tempfile

parser = argparse.ArgumentParser()
parser.add_argument('--output', type=pathlib.Path)
args = parser.parse_args()
output = args.output or pathlib.Path(tempfile.mkdtemp(prefix='mv3-browser-'))
output.mkdir(parents=True, exist_ok=True)
source = pathlib.Path(__file__).parent
for browser in ['chrome', 'firefox']:
    extension = output / browser
    extension.mkdir(exist_ok=True)
    (extension / 'manifest.json').write_text((source / f'manifest.{browser}.json').read_text())
    for file in ['background.js', 'empty.js']:
        (extension / file).write_text((source / file).read_text())


class Collector(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        self.send_response(200)
        self.send_header('Content-Type', 'text/html; charset=utf-8')
        self.end_headers()
        self.wfile.write(
            b'<html><title>MV3 transfer fixture</title><body>'
            b'<script>globalThis.__mv3PageSentinel = "page-world";</script>'
            b'</body></html>'
        )

    def do_POST(self):
        result = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
        browser = 'firefox' if 'Firefox/' in result['userAgent'] else 'chrome'
        (output / f'{browser}-results.json').write_text(json.dumps(result, indent=2))
        print(f'{browser} results saved', flush=True)
        self.send_response(200)
        self.end_headers()
        self.wfile.write(b'ok')


print(f'Fixture directories and results: {output}', flush=True)
http.server.ThreadingHTTPServer(('127.0.0.1', 8799), Collector).serve_forever()
