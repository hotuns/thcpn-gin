#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="${SCRIPT_DIR}/site.env"
COMPOSE_FILE="${SCRIPT_DIR}/compose.yaml"

if ! command -v docker >/dev/null 2>&1; then
  echo "Error: docker is not installed or not in PATH." >&2
  exit 1
fi

if ! docker compose version >/dev/null 2>&1; then
  echo "Error: docker compose v2 plugin is required." >&2
  exit 1
fi

if [[ ! -f "${ENV_FILE}" ]]; then
  cp "${SCRIPT_DIR}/site.env.example" "${ENV_FILE}"
  echo "Created ${ENV_FILE} from site.env.example."
  echo "Please review INIT_ADMIN_EMAIL / INIT_ADMIN_PASSWORD / PLATFORM_PUBLIC_URL and re-run ./install.sh."
  exit 0
fi

if [[ ! -f "${SCRIPT_DIR}/site/index.html" || ! -f "${SCRIPT_DIR}/site/admin/index.html" ]]; then
  echo "Error: ${SCRIPT_DIR}/site is missing frontend assets. Run ./build-lite.sh first." >&2
  exit 1
fi

if [[ ! -d "${SCRIPT_DIR}/migrations" ]]; then
  echo "Error: ${SCRIPT_DIR}/migrations is missing. Run ./build-lite.sh first." >&2
  exit 1
fi

generate_secret() {
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -hex 24
  else
    python3 -c 'import secrets; print(secrets.token_hex(24))'
  fi
}

generate_uuid() {
  if command -v uuidgen >/dev/null 2>&1; then
    uuidgen | tr '[:upper:]' '[:lower:]'
  else
    python3 -c 'import uuid; print(uuid.uuid4())'
  fi
}

set_env_if_empty() {
  local key="$1"
  local value="$2"
  if grep -qE "^${key}=" "${ENV_FILE}"; then
    local current
    current="$(grep -E "^${key}=" "${ENV_FILE}" | tail -n 1 | cut -d= -f2-)"
    if [[ -z "${current}" ]]; then
      python3 - "${ENV_FILE}" "${key}" "${value}" <<'PY'
import sys
path, key, value = sys.argv[1], sys.argv[2], sys.argv[3]
with open(path, "r", encoding="utf-8") as f:
    lines = f.readlines()
out = []
replaced = False
for line in lines:
    if line.startswith(f"{key}=") and not replaced:
        out.append(f"{key}={value}\n")
        replaced = True
    else:
        out.append(line)
with open(path, "w", encoding="utf-8") as f:
    f.writelines(out)
PY
      echo "Generated ${key} in ${ENV_FILE}."
    fi
  else
    printf "\n%s=%s\n" "${key}" "${value}" >> "${ENV_FILE}"
    echo "Appended ${key} to ${ENV_FILE}."
  fi
}

set_env_if_empty "POSTGRES_PASSWORD" "$(generate_secret)"
set_env_if_empty "JWT_SECRET" "$(generate_secret)"
set_env_if_empty "ADMIN_JWT_SECRET" "$(generate_secret)"
set_env_if_empty "DEPLOYMENT_WORKSPACE_ID" "$(generate_uuid)"

set -a
# shellcheck disable=SC1090
source "${ENV_FILE}"
set +a

if [[ -z "${INIT_ADMIN_EMAIL:-}" || -z "${INIT_ADMIN_PASSWORD:-}" ]]; then
  echo "Error: INIT_ADMIN_EMAIL and INIT_ADMIN_PASSWORD must be set in ${ENV_FILE}." >&2
  exit 1
fi

mkdir -p \
  "${SCRIPT_DIR}/data/postgres" \
  "${SCRIPT_DIR}/data/redis" \
  "${SCRIPT_DIR}/data/objects" \
  "${SCRIPT_DIR}/data/logs" \
  "${SCRIPT_DIR}/data/export-tmp" \
  "${SCRIPT_DIR}/data/caddy" \
  "${SCRIPT_DIR}/data/caddy-config"

compose() {
  docker compose -f "${COMPOSE_FILE}" --env-file "${ENV_FILE}" "$@"
}

echo "==> Starting PostgreSQL and Redis..."
compose up -d postgres redis

echo "==> Running database migrations..."
compose --profile tools run --rm migrate

echo "==> Bootstrapping single-workspace Lite deployment (adminctl onprem-init)..."
compose --profile tools run --rm bootstrap

echo "==> Starting IES Watch Lite services (postgres, redis, api, worker, web)..."
compose up -d

PORT="${SITE_WEB_PORT:-80}"
HEALTH_URL="http://127.0.0.1:${PORT}/readyz"
echo "==> Waiting for ${HEALTH_URL}..."
for i in $(seq 1 30); do
  if curl -fsS "${HEALTH_URL}" >/dev/null 2>&1; then
    echo "IES Watch Lite is ready!"
    echo "  Platform: ${PLATFORM_PUBLIC_URL:-http://127.0.0.1:${PORT}}/atlas"
    echo "  Admin:    ${PLATFORM_PUBLIC_URL:-http://127.0.0.1:${PORT}}/admin/"
    exit 0
  fi
  sleep 2
done

echo "Warning: service did not report ready within 60s. Check logs with:" >&2
echo "  docker compose -f ${COMPOSE_FILE} --env-file ${ENV_FILE} logs -f api web" >&2
exit 1
