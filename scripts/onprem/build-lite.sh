#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
APP_DIR="${REPO_ROOT}/app"
SITE_DIR="${SCRIPT_DIR}/site"
MIGRATIONS_DIR="${SCRIPT_DIR}/migrations"

BUILD_IMAGE=false
IMAGE_NAME="${IESWATCH_IMAGE:-ieswatch-lite:latest}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --build-image)
      BUILD_IMAGE=true
      shift
      ;;
    --image)
      IMAGE_NAME="$2"
      shift 2
      ;;
    *)
      echo "Unknown argument: $1" >&2
      echo "Usage: $0 [--build-image] [--image <name:tag>]" >&2
      exit 2
      ;;
  esac
done

if [[ -f "${SCRIPT_DIR}/site.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "${SCRIPT_DIR}/site.env"
  set +a
fi

echo "==> Building @thcpn/platform (VITE_LITE_MODE=true)..."
(
  cd "${APP_DIR}"
  VITE_LITE_MODE=true VITE_TIANDITU_TOKEN="${VITE_TIANDITU_TOKEN:-}" \
    npm --workspace @thcpn/platform run build
)

echo "==> Building @thcpn/admin (VITE_LITE_MODE=true)..."
(
  cd "${APP_DIR}"
  VITE_LITE_MODE=true VITE_TIANDITU_TOKEN="${VITE_TIANDITU_TOKEN:-}" \
    npm --workspace @thcpn/admin run build
)

echo "==> Packaging static site into ${SITE_DIR}..."
rm -rf "${SITE_DIR}"
mkdir -p "${SITE_DIR}/admin"
cp -R "${APP_DIR}/apps/platform/dist/." "${SITE_DIR}/"
cp -R "${APP_DIR}/apps/admin/dist/." "${SITE_DIR}/admin/"

echo "==> Copying SQL migrations into ${MIGRATIONS_DIR}..."
rm -rf "${MIGRATIONS_DIR}"
mkdir -p "${MIGRATIONS_DIR}"
cp -R "${REPO_ROOT}/migrations/." "${MIGRATIONS_DIR}/"

if [[ "${BUILD_IMAGE}" == "true" ]]; then
  echo "==> Building backend Docker image ${IMAGE_NAME}..."
  docker build -f "${REPO_ROOT}/Dockerfile" -t "${IMAGE_NAME}" "${REPO_ROOT}"
fi

echo "Done. Static assets ready at ${SITE_DIR} (platform at /, admin at /admin/)."
