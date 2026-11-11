#!/usr/bin/env python3
"""Exercise nginx upstream replacement in an isolated Docker network."""

import argparse
import json
from pathlib import Path
import subprocess
import tempfile
import time
import uuid


def docker(*args):
    return subprocess.check_output(["docker", *map(str, args)], text=True).strip()


def check_proxy(image, config, targets):
    prefix = "ieswatch-proxy-test-" + uuid.uuid4().hex[:10]
    network = prefix + "-net"
    containers = []
    with tempfile.TemporaryDirectory(prefix=prefix) as directory:
        root = Path(directory)
        main = root / "nginx.conf"
        main.write_text(
            "worker_processes 1; error_log /dev/stderr warn;\n"
            "events { worker_connections 64; }\n"
            "http { access_log off; include /etc/nginx/mime.types; "
            "include /etc/nginx/conf.d/default.conf; }\n"
        )

        def start(name, config_file=None, alias=None, ip=None):
            command = ["run", "-d", "--name", name, "--network", network]
            if alias:
                command += ["--network-alias", alias]
            if ip:
                command += ["--ip", ip]
            if config_file:
                command += [
                    "-v", f"{main}:/etc/nginx/nginx.conf:ro",
                    "-v", f"{config_file}:/etc/nginx/conf.d/default.conf:ro",
                    "--entrypoint", "nginx", image, "-g", "daemon off;",
                ]
            else:
                command += ["--entrypoint", "/bin/sh", image, "-c", "sleep 300"]
            docker(*command)
            containers.append(name)
            return name

        def peer(role, generation):
            file = root / f"{role}-{generation}.conf"
            port = 8080 if role == "api" else 80
            file.write_text(
                f'server {{ listen {port}; location / {{ return 200 '
                f'"{role}-{generation}:$request_uri"; }} }}\n'
            )
            return start(prefix + f"-{role}-{generation}", file, alias=role)

        def address(name):
            info = json.loads(docker("inspect", name))[0]
            return info["NetworkSettings"]["Networks"][network]["IPAddress"]

        def response(proxy, route):
            result = subprocess.run(
                ["docker", "exec", proxy, "wget", "-q", "-T", "2", "-O", "-",
                 "http://127.0.0.1" + route],
                capture_output=True, text=True,
            )
            return result.stdout if result.returncode == 0 else ""

        def await_response(proxy, route, expected):
            deadline = time.monotonic() + 15
            while time.monotonic() < deadline:
                if response(proxy, route) == expected:
                    return
                time.sleep(0.5)
            raise RuntimeError(f"{config.name}: proxy failed after upstream replacement at {route}")

        docker("network", "create", network)
        try:
            peers = {role: peer(role, "first") for role in ["api", "admin"]}
            proxy_config = root / "proxy.conf"
            proxy_config.write_bytes(config.read_bytes())
            proxy = start(prefix + "-proxy", proxy_config)
            for role, route in targets:
                await_response(proxy, route, role + "-first:" + route)
                old = address(peers[role])
                docker("rm", "-f", peers[role])
                # Occupy the old IP so replacement cannot accidentally reuse it.
                start(prefix + "-old-" + role, ip=old)
                peers[role] = peer(role, "second")
                new = address(peers[role])
                assert old != new
                await_response(proxy, route, role + "-second:" + route)
                print(f"PASS {config.name}: {role} changed IP; proxy recovered without reload", flush=True)
        finally:
            for container in reversed(containers):
                subprocess.run(["docker", "rm", "-f", container], capture_output=True)
            subprocess.run(["docker", "network", "rm", network], capture_output=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--image", required=True, help="Locally available nginx 1.27.3+ image; never pulled.")
    parser.add_argument("--config-dir", type=Path, default=Path(__file__).resolve().parents[2] / "app/deploy")
    args = parser.parse_args()
    docker("image", "inspect", args.image)
    try:
        check_proxy(args.image, args.config_dir / "nginx-platform.conf", [
            ("api", "/api/proxy-check?first=1&second=2"),
            ("admin", "/admin/proxy-check?first=1&second=2"),
        ])
        check_proxy(args.image, args.config_dir / "nginx-admin.conf", [
            ("api", "/api/proxy-check?first=1&second=2"),
        ])
    except RuntimeError as error:
        parser.exit(1, f"FAIL {error}\n")


if __name__ == "__main__":
    main()
