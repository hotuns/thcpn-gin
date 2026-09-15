package datasource

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"sync"
	"time"

	"github.com/go-sql-driver/mysql"
	"github.com/jackc/pgx/v5/pgxpool"
	"thcpn-gin/internal/apperr"
)

type sourceConnection struct {
	fingerprint [32]byte
	mysql       *sql.DB
	postgres    *pgxpool.Pool
}
type sourceConnections struct {
	mu      sync.Mutex
	entries map[string]sourceConnection
}

var sharedSourceConnections = &sourceConnections{entries: map[string]sourceConnection{}}

func CloseDataSourceConnections() { sharedSourceConnections.close() }
func (r *Runtime) Close() {
	if r != nil && r.connections != nil && r.connections != sharedSourceConnections {
		r.connections.close()
	}
}
func (c *sourceConnections) close() {
	c.mu.Lock()
	entries := c.entries
	c.entries = map[string]sourceConnection{}
	c.mu.Unlock()
	for _, entry := range entries {
		entry.close()
	}
}
func (entry sourceConnection) close() {
	if entry.mysql != nil {
		_ = entry.mysql.Close()
	}
	if entry.postgres != nil {
		entry.postgres.Close()
	}
}

func (r *Runtime) mysqlConnection(ctx context.Context, source DataSource, databaseName string) (*sql.DB, error) {
	dsn, err := r.resolver.Resolve(ctx, source.DsnSecretRef)
	if err != nil {
		return nil, err
	}
	cfg, err := mysql.ParseDSN(dsn)
	if err != nil {
		return nil, apperr.Wrap(apperr.KindDataSource, "parse mysql data source dsn", err)
	}
	cfg.ParseTime = true
	if databaseName != "" {
		cfg.DBName = databaseName
	}
	if cfg.Timeout == 0 {
		cfg.Timeout = 10 * time.Second
	}
	if cfg.ReadTimeout == 0 {
		cfg.ReadTimeout = 30 * time.Second
	}
	if cfg.WriteTimeout == 0 {
		cfg.WriteTimeout = 30 * time.Second
	}
	dsn = cfg.FormatDSN()
	key := source.ID.String() + "/mysql/" + databaseName
	fingerprint := sha256.Sum256([]byte(dsn))
	c := r.connections
	c.mu.Lock()
	previous, exists := c.entries[key]
	if exists && previous.fingerprint == fingerprint {
		c.mu.Unlock()
		return previous.mysql, nil
	}
	db, err := sql.Open("mysql", dsn)
	if err != nil {
		c.mu.Unlock()
		return nil, apperr.Wrap(apperr.KindDataSource, "open mysql data source", err)
	}
	db.SetMaxOpenConns(16)
	db.SetMaxIdleConns(4)
	db.SetConnMaxLifetime(5 * time.Minute)
	db.SetConnMaxIdleTime(time.Minute)
	c.entries[key] = sourceConnection{fingerprint: fingerprint, mysql: db}
	c.mu.Unlock()
	if exists {
		previous.close()
	}
	return db, nil
}

func (r *Runtime) postgresConnection(ctx context.Context, source DataSource) (*pgxpool.Pool, error) {
	dsn, err := r.resolver.Resolve(ctx, source.DsnSecretRef)
	if err != nil {
		return nil, err
	}
	cfg, err := pgxpool.ParseConfig(dsn)
	if err != nil {
		return nil, apperr.Wrap(apperr.KindDataSource, "parse postgres data source", err)
	}
	if cfg.ConnConfig.ConnectTimeout == 0 {
		cfg.ConnConfig.ConnectTimeout = 10 * time.Second
	}
	key := source.ID.String() + "/postgres"
	fingerprint := sha256.Sum256([]byte(dsn))
	c := r.connections
	c.mu.Lock()
	previous, exists := c.entries[key]
	if exists && previous.fingerprint == fingerprint {
		c.mu.Unlock()
		return previous.postgres, nil
	}
	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		c.mu.Unlock()
		return nil, err
	}
	c.entries[key] = sourceConnection{fingerprint: fingerprint, postgres: pool}
	c.mu.Unlock()
	if exists {
		previous.close()
	}
	return pool, nil
}
