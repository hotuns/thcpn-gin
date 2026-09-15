package testdb

import (
	"context"
	"os"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

func Open(t *testing.T, through int) *pgxpool.Pool {
	t.Helper()
	dsn := os.Getenv("THCPN_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("THCPN_TEST_DATABASE_URL is required for isolated PostgreSQL integration tests")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	admin, err := pgx.Connect(ctx, dsn)
	if err != nil {
		t.Fatal(err)
	}
	name := "thcpn_test_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	if _, err := admin.Exec(ctx, "CREATE DATABASE "+pgx.Identifier{name}.Sanitize()); err != nil {
		_ = admin.Close(ctx)
		t.Fatal(err)
	}
	cfg, err := pgxpool.ParseConfig(dsn)
	if err != nil {
		t.Fatal(err)
	}
	cfg.ConnConfig.Database = name
	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		pool.Close()
		cleanup, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		_, _ = admin.Exec(cleanup, "DROP DATABASE "+pgx.Identifier{name}.Sanitize()+" WITH (FORCE)")
		_ = admin.Close(cleanup)
	})
	_, file, _, _ := runtime.Caller(0)
	paths, err := filepath.Glob(filepath.Join(filepath.Dir(file), "../../migrations/*.up.sql"))
	if err != nil {
		t.Fatal(err)
	}
	for _, path := range paths {
		n, err := strconv.Atoi(strings.Split(filepath.Base(path), "_")[0])
		if err != nil {
			t.Fatal(err)
		}
		if through > 0 && n > through {
			break
		}
		Apply(t, pool, path)
	}
	return pool
}

func Apply(t *testing.T, pool *pgxpool.Pool, path string) {
	t.Helper()
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	tx, err := pool.Begin(t.Context())
	if err != nil {
		t.Fatal(err)
	}
	if _, err = tx.Exec(t.Context(), string(raw)); err != nil {
		_ = tx.Rollback(context.Background())
		t.Fatalf("migration %s: %v", path, err)
	}
	if err = tx.Commit(t.Context()); err != nil {
		t.Fatal(err)
	}
}

func Admin(t *testing.T, pool *pgxpool.Pool) uuid.UUID {
	t.Helper()
	id := uuid.New()
	_, err := pool.Exec(t.Context(), `INSERT INTO system_admins (id,name,email,password_hash) VALUES ($1,'Test admin',$2,'unused')`, id, id.String()+"@example.test")
	if err != nil {
		t.Fatal(err)
	}
	return id
}
