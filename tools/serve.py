"""Dev static server: like `python -m http.server`, but tells the browser never to cache.

Plain http.server sends Last-Modified without Cache-Control, so Chrome caches ES modules and
classic scripts heuristically; after an edit the page can load a mix of new and stale files
(2026-09-30: stale instanceRect.js / palette.js gave a black RTS page).

    python tools/serve.py [port] [--directory DIR]
"""
import argparse
import functools
import http.server


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, must-revalidate')
        self.send_header('Expires', '0')
        super().end_headers()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('port', nargs='?', type=int, default=8000)
    ap.add_argument('--directory', default='.')
    a = ap.parse_args()
    handler = functools.partial(NoCacheHandler, directory=a.directory)
    http.server.ThreadingHTTPServer.allow_reuse_address = True
    with http.server.ThreadingHTTPServer(('', a.port), handler) as httpd:
        print(f'Serving {a.directory} on http://localhost:{a.port}/ (no-store)')
        httpd.serve_forever()


if __name__ == '__main__':
    main()
