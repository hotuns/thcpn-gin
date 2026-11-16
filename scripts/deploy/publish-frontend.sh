#!/usr/bin/env bash
# Publish already-built platform/admin directories, then atomically switch Caddy's root.
set -euo pipefail

if [[ $# -lt 2 || $# -gt 3 || ! $1 =~ ^[0-9a-f]{40}$ ]]; then
  echo "Usage: $0 <full-commit-sha> <frontend-dir> [site-dir=/srv/ieswatch]" >&2
  exit 1
fi
commit=$1
frontend_dir=$(cd "$2" && pwd)
site_dir=${3:-/srv/ieswatch}
test -s "$frontend_dir/platform/index.html"
test -s "$frontend_dir/admin/index.html"
mkdir -p "$site_dir/releases"
site_dir=$(cd "$site_dir" && pwd)
release_dir="$site_dir/releases/$commit"
if [[ -e $release_dir ]]; then
  echo "Release already exists: $release_dir (use the existing release for rollback)" >&2
  exit 1
fi

stage=$(mktemp -d "$site_dir/releases/.staging.XXXXXX")
trap 'rm -rf "$stage"' EXIT
cp -R "$frontend_dir/platform/." "$stage/"
mkdir "$stage/admin"
cp -R "$frontend_dir/admin/." "$stage/admin/"
# Static files must remain readable even when the upload used umask 077.
find "$stage" -type d -exec chmod 755 {} +
find "$stage" -type f -exec chmod 644 {} +
chmod 755 "$site_dir" "$site_dir/releases"
mv "$stage" "$release_dir"
trap - EXIT

previous=$(readlink "$site_dir/current" || true)
ln -s "releases/$commit" "$site_dir/.current-$commit"
mv -Tf "$site_dir/.current-$commit" "$site_dir/current"
echo "Published: $release_dir"
echo "Previous: ${previous:-none}"
