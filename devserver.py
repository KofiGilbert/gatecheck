#!/usr/bin/env python3
"""Local preview server for Checkpoint.

python3 -m http.server lets the browser cache js/*.js, so an edit can sit on
disk while the page keeps running yesterday's code. This one refuses to be
cached, which is what you want while building and never what you want in
production - Netlify serves the real thing.

    python3 devserver.py [port]
"""
import socket
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

def lan_ip():
    """The address an iPad on the same wifi can reach this Mac on."""
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(('8.8.8.8', 80))
        return s.getsockname()[0]
    except OSError:
        return None
    finally:
        s.close()

if __name__ == '__main__':
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8080
    print('Checkpoint on http://localhost:%d  (nothing is cached)' % port)
    ip = lan_ip()
    if ip:
        print('On a phone or iPad on the same wifi:  http://%s:%d' % (ip, port))
    # 0.0.0.0, not 127.0.0.1, so the iPad can reach it. Local network only.
    ThreadingHTTPServer(('0.0.0.0', port), NoCache).serve_forever()
