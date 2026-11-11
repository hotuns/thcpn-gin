#!/usr/bin/env python3
"""Check real user/admin login proxy routes without using account credentials."""

import argparse
import json
import urllib.error
import urllib.request


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base", default="https://ieswatch.com")
    args = parser.parse_args()
    probes = [
        ("/login", None, 200, False),
        ("/admin/login", None, 200, False),
        ("/api/v1/system/policy", None, 200, True),
        ("/api/v1/me", None, 401, True),
        ("/api/v1/auth/password/login", b"{}", 400, True),
        ("/api/v1/admin/auth/password/login", b"{}", 400, True),
    ]
    failed = False
    for route, data, expected, expect_json in probes:
        request = urllib.request.Request(
            args.base.rstrip("/") + route, data=data,
            headers={"Content-Type": "application/json", "Cache-Control": "no-cache"},
        )
        try:
            try:
                response = urllib.request.urlopen(request, timeout=10)
            except urllib.error.HTTPError as error:
                response = error
            with response:
                body = response.read()
                valid = response.status == expected
                if expect_json:
                    valid = valid and response.headers.get_content_type() == "application/json"
                    try:
                        valid = valid and isinstance(json.loads(body), dict)
                    except (ValueError, UnicodeDecodeError):
                        valid = False
                print(f"{'PASS' if valid else 'FAIL'} {route}: HTTP {response.status} (expected {expected})")
                failed = failed or not valid
        except (OSError, urllib.error.URLError) as error:
            print(f"FAIL {route}: {type(error).__name__}")
            failed = True
    raise SystemExit(1 if failed else 0)


if __name__ == "__main__":
    main()
