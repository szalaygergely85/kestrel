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

    # OB-030: editor direct save. PUT /content/**.json from loopback only, <= 8 MB, inside <dir>/content/.
    def do_PUT(self):
        import os, urllib.parse
        if self.client_address[0] not in ('127.0.0.1', '::1'):
            return self.send_error(403, 'localhost only')
        host = (self.headers.get('Host') or '').split(':')[0]
        origin = self.headers.get('Origin') or ''
        if host not in ('localhost', '127.0.0.1', '[::1]') or (origin and urllib.parse.urlparse(origin).hostname not in ('localhost', '127.0.0.1', '::1')):
            return self.send_error(403, 'same-origin localhost only')  # no DNS-rebinding / cross-site writes
        path = urllib.parse.unquote(urllib.parse.urlparse(self.path).path)
        root = os.path.realpath(os.path.join(self.directory, 'content'))
        target = os.path.realpath(os.path.join(self.directory, path.lstrip('/')))
        n = int(self.headers.get('Content-Length') or 0)
        if not path.startswith('/content/') or not path.endswith('.json') or not target.startswith(root + os.sep):
            return self.send_error(403, 'only content/**.json')
        if n <= 0 or n > 8 * 1024 * 1024:
            return self.send_error(413, 'bad size')
        body = self.rfile.read(n)
        tmp = target + '.tmp'
        with open(tmp, 'wb') as f:
            f.write(body)
        os.replace(tmp, target)
        self.send_response(204)
        self.end_headers()
    # EV17-15: quest editor deletes a quest file. DELETE /content/quests/<name>.quest.json only, same loopback guard as PUT.
    def do_DELETE(self):
        import os, re, urllib.parse
        if self.client_address[0] not in ('127.0.0.1', '::1'):
            return self.send_error(403, 'localhost only')
        host = (self.headers.get('Host') or '').split(':')[0]
        origin = self.headers.get('Origin') or ''
        if host not in ('localhost', '127.0.0.1', '[::1]') or (origin and urllib.parse.urlparse(origin).hostname not in ('localhost', '127.0.0.1', '::1')):
            return self.send_error(403, 'same-origin localhost only')
        path = urllib.parse.unquote(urllib.parse.urlparse(self.path).path)
        if not re.fullmatch(r'/content/quests/[A-Za-z0-9_.-]+\.quest\.json', path):
            return self.send_error(403, 'only content/quests/*.quest.json')
        target = os.path.realpath(os.path.join(self.directory, path.lstrip('/')))
        if not os.path.isfile(target):
            return self.send_error(404)
        os.remove(target)
        self.send_response(204)
        self.end_headers()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('port', nargs='?', type=int, default=8000)
    ap.add_argument('--directory', default='.')
    a = ap.parse_args()
    handler = functools.partial(NoCacheHandler, directory=a.directory)
    http.server.ThreadingHTTPServer.allow_reuse_address = True
    http.server.ThreadingHTTPServer.request_queue_size = 128  # default 5: a cold page load fires ~200 script requests at once and Windows refuses the overflow (ERR_CONNECTION_REFUSED)
    with http.server.ThreadingHTTPServer(('', a.port), handler) as httpd:
        print(f'Serving {a.directory} on http://localhost:{a.port}/ (no-store)')
        httpd.serve_forever()


if __name__ == '__main__':
    main()
