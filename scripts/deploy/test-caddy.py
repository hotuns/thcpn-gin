#!/usr/bin/env python3
"""Exercise the production Caddy routes on loopback without touching live services."""

import argparse
import http.client
import json
import os
from pathlib import Path
import socket
import subprocess
import tempfile
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


class API(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path == "/api/v1/download":
            self.send_response(200)
            self.send_header("Content-Type", "application/zip")
            self.send_header("Content-Disposition", 'attachment; filename="export.zip"')
            self.end_headers()
            self.wfile.write(b"PK\x03\x04export")
            return
        size = int(self.headers.get("Content-Length", "0"))
        body = self.rfile.read(size)
        if len(body) != size:
            return  # Caddy closed the upstream request after enforcing the body limit.
        response = json.dumps({
            "path": self.path, "method": self.command, "size": len(body),
            "authorization": self.headers.get("Authorization"),
            "host": self.headers.get("Host"),
            "proto": self.headers.get("X-Forwarded-Proto"),
            "client_ip": self.headers.get("X-Real-IP"),
        }).encode()
        self.send_response(404 if self.path == "/api/v1/missing" else 200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(response)))
        self.end_headers()
        self.wfile.write(response)

    do_POST = do_GET

    def log_message(self, *args):
        pass


def request(port, path, method="GET", body=None, headers=None):
    conn = http.client.HTTPConnection("127.0.0.1", port, timeout=10)
    try:
        conn.request(method, path, body=body, headers=headers or {})
        response = conn.getresponse()
        return response.status, dict(response.getheaders()), response.read()
    finally:
        conn.close()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--caddy", default="caddy")
    args = parser.parse_args()
    scripts = Path(__file__).resolve().parent
    template = (scripts / "Caddyfile.ieswatch").read_text()
    snippet, _ = template.split("\nieswatch.com {", 1)
    with tempfile.TemporaryDirectory(prefix="ieswatch-caddy-test-") as tmp:
        root = Path(tmp)
        frontend = root / "frontend"
        for name in ("platform", "admin"):
            dist = frontend / name
            (dist / "assets").mkdir(parents=True)
            (dist / "index.html").write_text(f"<!doctype html><title>{name}</title>")
            (dist / "assets/app.js").write_text(f'console.log("{name}");')
            (dist / "index.html").chmod(0o600)
        site = root / "site"
        subprocess.run(["bash", str(scripts / "publish-frontend.sh"), "1" * 40,
                        str(frontend), str(site)], check=True, capture_output=True)
        assert (site / "current/index.html").stat().st_mode & 0o777 == 0o644
        assert (site / "current/admin").stat().st_mode & 0o777 == 0o755

        upstream = ThreadingHTTPServer(("127.0.0.1", 0), API)
        thread = threading.Thread(target=upstream.serve_forever, daemon=True)
        thread.start()
        with socket.socket() as sock:
            sock.bind(("127.0.0.1", 0))
            port = sock.getsockname()[1]
        env = dict(os.environ, IESWATCH_WEB_ROOT=str(site / "current"),
                   IESWATCH_API_UPSTREAM=f"127.0.0.1:{upstream.server_port}",
                   XDG_CONFIG_HOME=str(root / "config"), XDG_DATA_HOME=str(root / "data"))
        config = root / "Caddyfile"
        config.write_text("{\n admin off\n auto_https off\n grace_period 1s\n}\n" + snippet
                          + f"\nhttp://127.0.0.1:{port} {{\n bind 127.0.0.1\n import ieswatch_frontend\n}}\n")
        with (root / "caddy.log").open("w+") as log:
            process = subprocess.Popen([args.caddy, "run", "--config", str(config),
                                        "--adapter", "caddyfile"], env=env, stdout=log, stderr=log)
            try:
                for _ in range(100):
                    try:
                        request(port, "/healthz")
                        break
                    except OSError:
                        if process.poll() is not None:
                            raise RuntimeError("Caddy exited before startup")
                        time.sleep(0.1)
                else:
                    raise RuntimeError("Caddy startup timed out")

                for path, name in [("/", "platform"), ("/login", "platform"),
                                   ("/workspaces/test/devices/123?tab=data", "platform"),
                                   ("/admin/", "admin"), ("/admin/login", "admin"),
                                   ("/admin/devices/123?tab=nodes", "admin")]:
                    status, _, body = request(port, path)
                    assert status == 200 and body == (frontend / name / "index.html").read_bytes(), path
                status, headers, _ = request(port, "/admin?next=devices")
                assert status == 308 and headers["Location"] == "/admin/?next=devices"
                for path, name in [("/assets/app.js", "platform"), ("/admin/assets/app.js", "admin")]:
                    status, headers, body = request(port, path)
                    assert status == 200 and "javascript" in headers["Content-Type"], path
                    assert body == (frontend / name / "assets/app.js").read_bytes(), path
                status, headers, body = request(port, "/admin/assets/app.js", headers={"Range": "bytes=0-6"})
                assert status == 206 and body == b"console" and "Content-Range" in headers
                print("PASS platform/admin routes, query redirect, static MIME and byte ranges")

                for path in ("/api", "/api/v1/me?probe=1", "/healthz", "/readyz"):
                    status, _, body = request(port, path, headers={"Authorization": "Bearer test-fixture"})
                    data = json.loads(body)
                    assert status == 200 and data["path"] == path, path
                    assert data["authorization"] == "Bearer test-fixture"
                    assert data["host"] == f"127.0.0.1:{port}"
                    assert data["proto"] == "http" and data["client_ip"] == "127.0.0.1"
                status, headers, _ = request(port, "/api/v1/missing")
                assert status == 404 and headers["Content-Type"] == "application/json"
                print("PASS API/health routing, credentials, forwarded headers and API 404")

                body = b"x" * (10 * 1024 * 1024)
                status, _, response = request(port, "/api/v1/upload", "POST", body)
                data = json.loads(response)
                assert status == 200 and data["size"] == len(body) and data["method"] == "POST"
                status, _, _ = request(port, "/api/v1/upload", "POST", body + b"x")
                assert status == 413, f"oversized body returned {status}"
                status, headers, body = request(port, "/api/v1/download")
                assert status == 200 and body == b"PK\x03\x04export"
                assert headers["Content-Disposition"] == 'attachment; filename="export.zip"'
                print("PASS 10 MiB upload, oversized rejection and download response")

                (frontend / "platform/index.html").write_text("release two")
                subprocess.run(["bash", str(scripts / "publish-frontend.sh"), "2" * 40,
                                str(frontend), str(site)], check=True, capture_output=True)
                assert request(port, "/login")[2] == b"release two"
                assert (site / ("releases/" + "1" * 40) / "index.html").read_text().startswith("<!doctype")
                print("PASS release permissions and atomic frontend update without reloading Caddy")
            except Exception:
                log.flush()
                log.seek(0)
                print(log.read())
                raise
            finally:
                process.terminate()
                try:
                    process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait(timeout=5)
                upstream.shutdown()
                upstream.server_close()


if __name__ == "__main__":
    main()
