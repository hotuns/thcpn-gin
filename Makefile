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

.PHONY: db-up db-down migrate-up migrate-down sqlc test run-api run-worker web-install run-web build-web

db-up:
	docker compose up -d postgres redis

db-down:
	docker compose down

migrate-up: db-up
	docker compose run --rm migrate -path=/migrations -database "$(MIGRATE_DATABASE_URL)" up

migrate-down: db-up
	docker compose run --rm migrate -path=/migrations -database "$(MIGRATE_DATABASE_URL)" down $(MIGRATE_STEPS)

sqlc:
	docker run --rm -v "$(PWD):/src" -w /src $(SQLC_IMAGE) generate

test:
	go test ./...

run-api:
	go run ./cmd/api

run-worker:
	go run ./cmd/worker

web-install:
	cd web && npm install

run-web:
	cd web && npm run dev -- --host 127.0.0.1

build-web:
	cd web && npm run build
