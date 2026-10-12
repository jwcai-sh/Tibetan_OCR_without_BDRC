#!/usr/bin/env python3
"""No-cache static HTTP server for the Tibetan proofreading app."""

from __future__ import annotations

import argparse
import cgi
import json
import shutil
import subprocess
import tempfile
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


class NoCacheHandler(SimpleHTTPRequestHandler):
    def end_headers(self) -> None:
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()

    def do_OPTIONS(self) -> None:
        if self.path.rstrip("/") == "/api/render-pdf-page":
            self.send_response(204)
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
            self.send_header("Access-Control-Allow-Headers", "Content-Type")
            self.end_headers()
            return
        super().do_OPTIONS()

    def do_POST(self) -> None:
        if self.path.rstrip("/") != "/api/render-pdf-page":
            self.send_error(404, "Not found")
            return
        self.render_pdf_page()

    def render_pdf_page(self) -> None:
        if not shutil.which("pdftoppm"):
            self.send_json({"error": "pdftoppm not found. Install poppler first."}, status=500)
            return

        try:
            form = cgi.FieldStorage(
                fp=self.rfile,
                headers=self.headers,
                environ={
                    "REQUEST_METHOD": "POST",
                    "CONTENT_TYPE": self.headers.get("Content-Type", ""),
                    "CONTENT_LENGTH": self.headers.get("Content-Length", "0"),
                },
            )
            file_item = form["file"] if "file" in form else None
            if file_item is None or not getattr(file_item, "file", None):
                raise RuntimeError('multipart field "file" is required')

            page = max(1, int(form.getfirst("page", "1")))
            dpi = min(420, max(72, int(form.getfirst("dpi", "180"))))
            pdf_bytes = file_item.file.read()
            if not pdf_bytes:
                raise RuntimeError("uploaded PDF is empty")

            with tempfile.TemporaryDirectory(prefix="tibetan-pdf-render-") as tmp_dir:
                tmp_path = Path(tmp_dir)
                pdf_path = tmp_path / "input.pdf"
                out_prefix = tmp_path / "page"
                pdf_path.write_bytes(pdf_bytes)
                subprocess.run(
                    [
                        "pdftoppm",
                        "-f",
                        str(page),
                        "-l",
                        str(page),
                        "-singlefile",
                        "-png",
                        "-r",
                        str(dpi),
                        str(pdf_path),
                        str(out_prefix),
                    ],
                    check=True,
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.PIPE,
                )
                output = tmp_path / "page.png"
                if not output.exists():
                    raise RuntimeError("pdftoppm did not produce a PNG page")
                png_bytes = output.read_bytes()

            self.send_response(200)
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Content-Type", "image/png")
            self.send_header("Content-Length", str(len(png_bytes)))
            self.end_headers()
            self.wfile.write(png_bytes)
        except subprocess.CalledProcessError as exc:
            detail = exc.stderr.decode("utf-8", errors="replace").strip() if exc.stderr else str(exc)
            self.send_json({"error": detail or "pdftoppm failed"}, status=500)
        except Exception as exc:
            self.send_json({"error": str(exc)}, status=500)

    def send_json(self, payload: dict, status: int = 200) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8790)
    parser.add_argument("--directory", default=".")
    args = parser.parse_args()

    handler = partial(NoCacheHandler, directory=args.directory)
    server = ThreadingHTTPServer((args.host, args.port), handler)
    print(f"Serving {args.directory} at http://{args.host}:{args.port}/ with no-cache headers")
    server.serve_forever()


if __name__ == "__main__":
    main()
