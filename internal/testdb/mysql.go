package testdb

import (
	"database/sql"
	"github.com/go-sql-driver/mysql"
	"os"
	"testing"
)

// MySQL creates a fresh database on an explicitly configured isolated test server.
// Existing databases are never reused, and only this newly created database is removed.
func MySQL(t *testing.T, name string) (*sql.DB, string) {
	t.Helper()
	dsn := os.Getenv("THCPN_TEST_MYSQL_DSN")
	if dsn == "" {
		t.Skip("THCPN_TEST_MYSQL_DSN is required for isolated MySQL integration tests")
	}
	cfg, err := mysql.ParseDSN(dsn)
	if err != nil {
		t.Fatal(err)
	}
	cfg.DBName = ""
	cfg.ParseTime = true
	root, err := sql.Open("mysql", cfg.FormatDSN())
	if err != nil {
		t.Fatal(err)
	}
	if _, err = root.ExecContext(t.Context(), "CREATE DATABASE `"+name+"`"); err != nil {
		root.Close()
		t.Fatalf("test requires a fresh MySQL database: %v", err)
	}
	t.Cleanup(func() { root.Exec("DROP DATABASE `" + name + "`"); root.Close() })
	cfg.DBName = name
	db, err := sql.Open("mysql", cfg.FormatDSN())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Close() })
	return db, cfg.FormatDSN()
}
