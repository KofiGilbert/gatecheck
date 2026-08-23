#!/usr/bin/env python3
"""Local preview server for Checkpoint.

python3 -m http.server lets the browser cache js/*.js, so an edit can sit on
disk while the page keeps running yesterday's code. This one refuses to be
cached, which is what you want while building and never what you want in
production - Netlify serves the real thing.

    python3 devserver.py [port]
"""
import sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

class NoCache(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
        self.send_header('Pragma', 'no-cache')
        self.send_header('Expires', '0')
        super().end_headers()
    def log_message(self, *a):
        pass

if __name__ == '__main__':
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8080
    print('Checkpoint on http://localhost:%d  (nothing is cached)' % port)
    ThreadingHTTPServer(('127.0.0.1', port), NoCache).serve_forever()
