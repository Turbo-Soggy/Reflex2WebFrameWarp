"""Tiny static file server for the Frame Warp demo.

Like `python -m http.server` but:
  * sends no-cache headers, so the browser always re-fetches edited JS modules
    (plain http.server returns 304s and you end up running stale code), and
  * is threaded and tolerant of dropped connections (a browser reload that
    disconnects mid-response must not crash the server).

Run with:  python serve.py  [port]
"""
import http.server
import socketserver
import sys

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8000


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()

    def do_POST(self):
        if self.path == '/log':
            content_length = int(self.headers['Content-Length'])
            post_data = self.rfile.read(content_length)
            with open('server.log', 'a') as f:
                f.write(post_data.decode('utf-8') + '\n')
            self.send_response(200)
            self.send_header('Content-type', 'text/plain')
            self.end_headers()
            self.wfile.write(b"OK")
            return
        self.send_error(404)

    def copyfile(self, source, outputfile):
        # Swallow the broken-pipe / reset that occurs when the browser navigates
        # away mid-response, instead of letting it bubble up.
        try:
            super().copyfile(source, outputfile)
        except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
            pass

    def log_message(self, fmt, *args):
        pass  # quiet


class Server(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True
    allow_reuse_address = True


if __name__ == "__main__":
    with Server(("", PORT), NoCacheHandler) as httpd:
        print(f"Frame Warp dev server (no-cache, threaded) on http://localhost:{PORT}")
        httpd.serve_forever()
