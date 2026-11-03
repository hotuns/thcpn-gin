// Package statisticstest provides a network-free SQL driver for source statistics tests.
package statisticstest

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"errors"
	"io"
	"reflect"
	"strings"
	"sync"
	"testing"
)

type Step struct {
	Contains []string
	Excludes []string
	Args     []driver.Value
	Columns  []string
	Rows     [][]driver.Value
	Err      error
	Exec     bool
}

type connector struct {
	t     testing.TB
	steps []Step
	mu    sync.Mutex
}
type conn struct{ *connector }
type rows struct {
	columns []string
	values  [][]driver.Value
	index   int
}
type unusedDriver struct{}

func (unusedDriver) Open(string) (driver.Conn, error)             { return nil, errors.New("use test connector") }
func (c *connector) Driver() driver.Driver                        { return unusedDriver{} }
func (c *connector) Connect(context.Context) (driver.Conn, error) { return &conn{c}, nil }
func (c *conn) Prepare(string) (driver.Stmt, error)               { return nil, errors.New("unexpected prepare") }
func (c *conn) Begin() (driver.Tx, error)                         { return nil, errors.New("unexpected transaction") }
func (c *conn) Close() error                                      { return nil }
func New(t testing.TB, steps ...Step) *sql.DB {
	t.Helper()
	c := &connector{t: t, steps: steps}
	db := sql.OpenDB(c)
	t.Cleanup(func() {
		db.Close()
		c.mu.Lock()
		defer c.mu.Unlock()
		if len(c.steps) != 0 {
			t.Errorf("%d unconsumed SQL steps", len(c.steps))
		}
	})
	return db
}
func (c *conn) next(query string, args []driver.NamedValue, exec bool) (Step, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if len(c.steps) == 0 {
		c.t.Errorf("unexpected SQL: %s", query)
		return Step{}, errors.New("unexpected SQL")
	}
	step := c.steps[0]
	c.steps = c.steps[1:]
	if exec != step.Exec {
		c.t.Errorf("query/exec mismatch: %s", query)
	}
	for _, part := range step.Contains {
		if !strings.Contains(query, part) {
			c.t.Errorf("SQL missing %q: %s", part, query)
		}
	}
	for _, part := range step.Excludes {
		if strings.Contains(query, part) {
			c.t.Errorf("SQL unexpectedly contains %q: %s", part, query)
		}
	}
	if step.Args != nil {
		values := make([]driver.Value, len(args))
		for i, arg := range args {
			values[i] = arg.Value
		}
		if !reflect.DeepEqual(values, step.Args) {
			c.t.Errorf("SQL args=%#v, want %#v", values, step.Args)
		}
	}
	return step, step.Err
}
func (c *conn) QueryContext(_ context.Context, query string, args []driver.NamedValue) (driver.Rows, error) {
	step, err := c.next(query, args, false)
	if err != nil {
		return nil, err
	}
	return &rows{columns: step.Columns, values: step.Rows}, nil
}
func (c *conn) ExecContext(_ context.Context, query string, args []driver.NamedValue) (driver.Result, error) {
	_, err := c.next(query, args, true)
	return driver.RowsAffected(0), err
}
func (r *rows) Columns() []string { return r.columns }
func (r *rows) Close() error      { return nil }
func (r *rows) Next(dest []driver.Value) error {
	if r.index >= len(r.values) {
		return io.EOF
	}
	copy(dest, r.values[r.index])
	r.index++
	return nil
}
