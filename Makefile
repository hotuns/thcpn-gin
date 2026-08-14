ifneq (,$(wildcard .env))
include .env
export
endif

POSTGRES_USER ?= thcpn
POSTGRES_PASSWORD ?= thcpn_dev_password
POSTGRES_DB ?= thcpn_platform
POSTGRES_PORT ?= 5432
MIGRATE_STEPS ?= 1

MIGRATE_DATABASE_URL ?= postgres://$(POSTGRES_USER):$(POSTGRES_PASSWORD)@postgres:5432/$(POSTGRES_DB)?sslmode=disable
MIGRATE_IMAGE ?= migrate/migrate:v4.17.1
SQLC_IMAGE ?= sqlc/sqlc:1.27.0

.PHONY: db-up db-down processor-up migrate-up migrate-down sqlc test stop-local run-api run-worker run-all app-install run-platform run-admin build-app

db-up:
	docker compose up -d postgres redis

db-down:
	docker compose down

processor-up:
	docker compose up -d --build processor

migrate-up: db-up
	docker compose run --rm migrate -path=/migrations -database "$(MIGRATE_DATABASE_URL)" up

migrate-down: db-up
	docker compose run --rm migrate -path=/migrations -database "$(MIGRATE_DATABASE_URL)" down $(MIGRATE_STEPS)

sqlc:
	docker run --rm -v "$(PWD):/src" -w /src $(SQLC_IMAGE) generate

test:
	go test ./...

stop-local:
	@echo "Stopping existing THCPN application services..."
	@for port in 8080 8081 5173 5174 5176; do \
		pids="$$(lsof -tiTCP:$$port -sTCP:LISTEN 2>/dev/null || true)"; \
		if [ -n "$$pids" ]; then \
			echo "  stopping port $$port (pid $$pids)"; \
			kill $$pids 2>/dev/null || true; \
		fi; \
	done
	@for pid in $$(pgrep -f '^go run \./cmd/(api|worker)$$' 2>/dev/null || true); do \
		children="$$(pgrep -P $$pid 2>/dev/null || true)"; \
		if [ -n "$$children" ]; then kill $$children 2>/dev/null || true; fi; \
		kill $$pid 2>/dev/null || true; \
	done
	@docker compose stop processor >/dev/null 2>&1 || true

run-api:
	go run ./cmd/api

run-worker:
	go run ./cmd/worker

run-all:
	$(MAKE) stop-local
	$(MAKE) migrate-up
	$(MAKE) processor-up
	$(MAKE) -j4 run-api run-worker run-platform run-admin

app-install:
	cd app && npm install

run-platform:
	cd app && npm run dev:platform

run-admin:
	cd app && npm run dev:admin

build-app:
	cd app && npm run build
