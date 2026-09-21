#!/usr/bin/env python3
"""
serve.py — a basic static server for HirePath that never serves stale files.

Python's built-in `python3 -m http.server` sends no Cache-Control header, so
browsers cache app.js and styles.css heuristically. During development that
means you edit a file, reload, and still see the old build — which looks like
a broken page rather than a caching problem.

This server is the same thing with caching switched off.

    python3 serve.py            # http://localhost:4180
    python3 serve.py 8000       # a different port

For hosting the finished site anywhere else, plain static hosting is fine:
index.html already versions its assets with ?v= query strings.
"""

import sys
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 4180
ROOT = Path(__file__).resolve().parent


class NoCacheHandler(SimpleHTTPRequestHandler):
    """Serves the HirePath folder and tells the browser not to cache anything."""

    def end_headers(self):
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()

    def log_message(self, fmt, *args):
        sys.stderr.write("%s  %s\n" % (self.log_date_time_string(), fmt % args))


def main():
    handler = partial(NoCacheHandler, directory=str(ROOT))
    with ThreadingHTTPServer(("127.0.0.1", PORT), handler) as httpd:
        print("HirePath is serving %s" % ROOT)
        print("Open http://localhost:%d  (caching is disabled)" % PORT)
        print("Press Ctrl+C to stop.")
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nStopped.")


if __name__ == "__main__":
    main()
