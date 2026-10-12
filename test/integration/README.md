# Integration Tests

Integration tests will use Docker-backed PostgreSQL, Redis, and device data sources in later stages.

## Temporary password login

`internal/adminuser/password_flow_integration_test.go` exercises admin-created users against a migrated local PostgreSQL database: generated temporary password, email/phone login, required first password change, rejection of the old password, and admin password reset.

Set `AUTH_FLOW_TEST_DSN` to an explicitly selected local test database and run:

```sh
go test ./internal/adminuser -run TestTemporaryPasswordLoginIntegration -v -count=1
```

Optionally set `AUTH_FLOW_TEST_LOCAL_HTTP=1` to also test the running local API at `127.0.0.1:8080`; it must use the same database. The fixture uses a unique email, never logs passwords or tokens, and removes its user and workspace afterwards. HTTP audit records may remain. Do not run against production.
