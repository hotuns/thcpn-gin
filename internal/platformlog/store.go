package platformlog

import (
	"bufio"
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	_ "modernc.org/sqlite"
)

type Config struct {
	Directory      string
	RetentionDays  int
	MaxTotalSizeMB int64
	MaxFileSizeMB  int64
	SQLiteIndex    bool
}

type Store struct {
	cfg     Config
	service string
	db      *sql.DB
	mu      sync.Mutex
	file    *os.File
	path    string
	day     string
	seq     int
}

type Entry struct {
	ID           int64          `json:"id"`
	Timestamp    time.Time      `json:"timestamp"`
	Level        string         `json:"level"`
	Service      string         `json:"service"`
	Message      string         `json:"message"`
	ActorType    string         `json:"actor_type,omitempty"`
	ActorID      string         `json:"actor_id,omitempty"`
	ActorName    string         `json:"actor_name,omitempty"`
	WorkspaceID  string         `json:"workspace_id,omitempty"`
	RequestID    string         `json:"request_id,omitempty"`
	TraceID      string         `json:"trace_id,omitempty"`
	Method       string         `json:"method,omitempty"`
	Path         string         `json:"path,omitempty"`
	Status       int            `json:"status,omitempty"`
	Fields       map[string]any `json:"fields,omitempty"`
	SourceFile   string         `json:"source_file,omitempty"`
	SourceOffset int64          `json:"-"`
}

type Query struct {
	Start, End                   time.Time
	Level, Service, ActorID      string
	WorkspaceID, RequestID, Path string
	Keyword                      string
	Status, Page, PageSize       int
}

type ListResult struct {
	Items    []Entry `json:"items"`
	Total    int64   `json:"total"`
	Page     int     `json:"page"`
	PageSize int     `json:"page_size"`
}
type Policy struct {
	Directory      string `json:"directory"`
	RetentionDays  int    `json:"retention_days"`
	MaxTotalSizeMB int64  `json:"max_total_size_mb"`
	MaxFileSizeMB  int64  `json:"max_file_size_mb"`
	UsedBytes      int64  `json:"used_bytes"`
	Indexed        bool   `json:"indexed"`
}
type FileInfo struct {
	Name       string    `json:"name"`
	Size       int64     `json:"size"`
	ModifiedAt time.Time `json:"modified_at"`
}

func Open(service string, cfg Config) (*Store, error) {
	if strings.TrimSpace(cfg.Directory) == "" {
		return nil, errors.New("log directory is required")
	}
	if err := os.MkdirAll(cfg.Directory, 0o750); err != nil {
		return nil, fmt.Errorf("create log directory: %w", err)
	}
	s := &Store{cfg: cfg, service: service}
	if cfg.SQLiteIndex {
		db, err := sql.Open("sqlite", filepath.Join(cfg.Directory, "logs-index.db"))
		if err != nil {
			return nil, err
		}
		db.SetMaxOpenConns(1)
		if _, err = db.Exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
CREATE TABLE IF NOT EXISTS log_entries (
 id INTEGER PRIMARY KEY AUTOINCREMENT, timestamp TEXT NOT NULL, level TEXT NOT NULL, service TEXT NOT NULL,
 message TEXT NOT NULL, actor_type TEXT, actor_id TEXT, actor_name TEXT, workspace_id TEXT, request_id TEXT,
 trace_id TEXT, method TEXT, path TEXT, status INTEGER, source_file TEXT NOT NULL, source_offset INTEGER NOT NULL,
 raw_json TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS log_entries_time_idx ON log_entries(timestamp DESC);
CREATE INDEX IF NOT EXISTS log_entries_request_idx ON log_entries(request_id);
CREATE INDEX IF NOT EXISTS log_entries_actor_idx ON log_entries(actor_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS log_entries_workspace_idx ON log_entries(workspace_id, timestamp DESC);`); err != nil {
			db.Close()
			return nil, err
		}
		s.db = db
	}
	if _, err := s.db.Exec(`CREATE UNIQUE INDEX IF NOT EXISTS log_entries_source_idx ON log_entries(source_file, source_offset)`); err != nil {
		_ = s.db.Close()
		return nil, err
	}
	return s, nil
}

func (s *Store) Close() error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.file != nil {
		_ = s.file.Close()
	}
	if s.db != nil {
		return s.db.Close()
	}
	return nil
}

func (s *Store) Write(ctx context.Context, entry Entry) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	entry.Service = s.service
	if entry.Timestamp.IsZero() {
		entry.Timestamp = time.Now().UTC()
	}
	raw, err := json.Marshal(entry)
	if err != nil {
		writeFailures.WithLabelValues(s.service, "marshal").Inc()
		return err
	}
	if err := s.ensureFile(entry.Timestamp, int64(len(raw)+1)); err != nil {
		writeFailures.WithLabelValues(s.service, "file").Inc()
		return err
	}
	offset, err := s.file.Seek(0, io.SeekEnd)
	if err != nil {
		return err
	}
	if _, err = s.file.Write(append(raw, '\n')); err != nil {
		writeFailures.WithLabelValues(s.service, "file").Inc()
		return err
	}
	if s.db != nil {
		_, err = s.db.ExecContext(ctx, `INSERT OR IGNORE INTO log_entries(timestamp,level,service,message,actor_type,actor_id,actor_name,workspace_id,request_id,trace_id,method,path,status,source_file,source_offset,raw_json) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
			entry.Timestamp.UTC().Format(time.RFC3339Nano), entry.Level, entry.Service, entry.Message, entry.ActorType, entry.ActorID, entry.ActorName, entry.WorkspaceID, entry.RequestID, entry.TraceID, entry.Method, entry.Path, entry.Status, filepath.Base(s.path), offset, string(raw))
	}
	if err != nil {
		writeFailures.WithLabelValues(s.service, "index").Inc()
	}
	return err
}

func (s *Store) ensureFile(now time.Time, incoming int64) error {
	day := now.UTC().Format("2006-01-02")
	rotate := s.file == nil || s.day != day
	if !rotate && s.cfg.MaxFileSizeMB > 0 {
		if info, err := s.file.Stat(); err == nil {
			rotate = info.Size()+incoming > s.cfg.MaxFileSizeMB*1024*1024
		}
	}
	if !rotate {
		return nil
	}
	if s.file != nil {
		_ = s.file.Close()
		s.file = nil
	}
	if s.day != day {
		s.seq = 0
	} else {
		s.seq++
	}
	s.day = day
	for {
		name := fmt.Sprintf("%s-%s-%03d.jsonl", s.service, day, s.seq)
		s.path = filepath.Join(s.cfg.Directory, name)
		info, err := os.Stat(s.path)
		if os.IsNotExist(err) || info.Size() < s.cfg.MaxFileSizeMB*1024*1024 {
			break
		}
		s.seq++
	}
	file, err := os.OpenFile(s.path, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o640)
	if err != nil {
		return err
	}
	s.file = file
	go s.Cleanup(context.Background())
	return nil
}

func (s *Store) List(ctx context.Context, q Query) (ListResult, error) {
	if s.db == nil {
		return ListResult{}, errors.New("log index is disabled")
	}
	if q.Page < 1 {
		q.Page = 1
	}
	if q.PageSize < 1 {
		q.PageSize = 100
	}
	if q.PageSize > 500 {
		q.PageSize = 500
	}
	where, args := []string{"1=1"}, []any{}
	add := func(sql string, value any) { where = append(where, sql); args = append(args, value) }
	if !q.Start.IsZero() {
		add("timestamp >= ?", q.Start.UTC().Format(time.RFC3339Nano))
	}
	if !q.End.IsZero() {
		add("timestamp < ?", q.End.UTC().Format(time.RFC3339Nano))
	}
	if q.Level != "" {
		add("level = ?", strings.ToUpper(q.Level))
	}
	if q.Service != "" {
		add("service = ?", q.Service)
	}
	if q.ActorID != "" {
		add("actor_id = ?", q.ActorID)
	}
	if q.WorkspaceID != "" {
		add("workspace_id = ?", q.WorkspaceID)
	}
	if q.RequestID != "" {
		add("request_id = ?", q.RequestID)
	}
	if q.Path != "" {
		add("path LIKE ?", "%"+q.Path+"%")
	}
	if q.Status > 0 {
		add("status = ?", q.Status)
	}
	if q.Keyword != "" {
		add("raw_json LIKE ?", "%"+q.Keyword+"%")
	}
	clause := strings.Join(where, " AND ")
	var total int64
	if err := s.db.QueryRowContext(ctx, "SELECT count(*) FROM log_entries WHERE "+clause, args...).Scan(&total); err != nil {
		return ListResult{}, err
	}
	rowsArgs := append(append([]any{}, args...), q.PageSize, (q.Page-1)*q.PageSize)
	rows, err := s.db.QueryContext(ctx, "SELECT id, raw_json, source_file, source_offset FROM log_entries WHERE "+clause+" ORDER BY timestamp DESC, id DESC LIMIT ? OFFSET ?", rowsArgs...)
	if err != nil {
		return ListResult{}, err
	}
	defer rows.Close()
	items := make([]Entry, 0, q.PageSize)
	for rows.Next() {
		var e Entry
		var raw string
		var id, offset int64
		var sourceFile string
		if err := rows.Scan(&id, &raw, &sourceFile, &offset); err != nil {
			return ListResult{}, err
		}
		if err := json.Unmarshal([]byte(raw), &e); err != nil {
			continue
		}
		e.ID, e.SourceFile, e.SourceOffset = id, sourceFile, offset
		items = append(items, e)
	}
	return ListResult{Items: items, Total: total, Page: q.Page, PageSize: q.PageSize}, rows.Err()
}

func (s *Store) Get(ctx context.Context, id int64) (Entry, error) {
	var e Entry
	var raw string
	var sourceFile string
	var sourceOffset int64
	if s.db == nil {
		return e, errors.New("log index is disabled")
	}
	if err := s.db.QueryRowContext(ctx, "SELECT raw_json,source_file,source_offset FROM log_entries WHERE id=?", id).Scan(&raw, &sourceFile, &sourceOffset); err != nil {
		return e, err
	}
	err := json.Unmarshal([]byte(raw), &e)
	e.ID, e.SourceFile, e.SourceOffset = id, sourceFile, sourceOffset
	return e, err
}

func (s *Store) Policy() Policy {
	var used int64
	entries, _ := os.ReadDir(s.cfg.Directory)
	for _, e := range entries {
		if info, err := e.Info(); err == nil {
			used += info.Size()
		}
	}
	directoryBytes.WithLabelValues(s.service).Set(float64(used))
	return Policy{Directory: s.cfg.Directory, RetentionDays: s.cfg.RetentionDays, MaxTotalSizeMB: s.cfg.MaxTotalSizeMB, MaxFileSizeMB: s.cfg.MaxFileSizeMB, UsedBytes: used, Indexed: s.db != nil}
}

func (s *Store) Files() ([]FileInfo, error) {
	entries, err := os.ReadDir(s.cfg.Directory)
	if err != nil {
		return nil, err
	}
	items := []FileInfo{}
	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".jsonl") {
			continue
		}
		info, err := entry.Info()
		if err != nil {
			continue
		}
		items = append(items, FileInfo{Name: entry.Name(), Size: info.Size(), ModifiedAt: info.ModTime()})
	}
	sort.Slice(items, func(i, j int) bool { return items[i].ModifiedAt.After(items[j].ModifiedAt) })
	return items, nil
}
func (s *Store) FilePath(name string) (string, error) {
	if name != filepath.Base(name) || !strings.HasSuffix(name, ".jsonl") {
		return "", errors.New("invalid log file name")
	}
	path := filepath.Join(s.cfg.Directory, name)
	if _, err := os.Stat(path); err != nil {
		return "", err
	}
	return path, nil
}

func (s *Store) Cleanup(ctx context.Context) {
	s.mu.Lock()
	activePath := s.path
	s.mu.Unlock()
	entries, err := os.ReadDir(s.cfg.Directory)
	if err != nil {
		return
	}
	type item struct {
		path, name string
		size       int64
		mod        time.Time
	}
	files := []item{}
	var total int64
	for _, e := range entries {
		if e.IsDir() || !strings.HasSuffix(e.Name(), ".jsonl") {
			continue
		}
		info, err := e.Info()
		if err != nil {
			continue
		}
		files = append(files, item{filepath.Join(s.cfg.Directory, e.Name()), e.Name(), info.Size(), info.ModTime()})
		total += info.Size()
	}
	sort.Slice(files, func(i, j int) bool { return files[i].mod.Before(files[j].mod) })
	cutoff := time.Now().AddDate(0, 0, -s.cfg.RetentionDays)
	max := s.cfg.MaxTotalSizeMB * 1024 * 1024
	today := time.Now().UTC().Format("2006-01-02")
	for _, f := range files {
		if f.path == activePath || strings.Contains(f.name, today) || (!f.mod.Before(cutoff) && total <= max) {
			continue
		}
		if os.Remove(f.path) == nil {
			total -= f.size
			if s.db != nil {
				_, _ = s.db.ExecContext(ctx, "DELETE FROM log_entries WHERE source_file=?", f.name)
			}
		}
	}
}

func (s *Store) Rebuild(ctx context.Context) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.db == nil {
		indexRebuilds.WithLabelValues(s.service, "failure").Inc()
		return errors.New("log index is disabled")
	}
	if _, err := s.db.ExecContext(ctx, "DELETE FROM log_entries"); err != nil {
		indexRebuilds.WithLabelValues(s.service, "failure").Inc()
		return err
	}
	entries, err := os.ReadDir(s.cfg.Directory)
	if err != nil {
		return err
	}
	for _, de := range entries {
		if !strings.HasSuffix(de.Name(), ".jsonl") {
			continue
		}
		path := filepath.Join(s.cfg.Directory, de.Name())
		file, err := os.Open(path)
		if err != nil {
			continue
		}
		scanner := bufio.NewScanner(file)
		scanner.Buffer(make([]byte, 64*1024), 2*1024*1024)
		var offset int64
		for scanner.Scan() {
			raw := append([]byte(nil), scanner.Bytes()...)
			var e Entry
			if json.Unmarshal(raw, &e) == nil {
				_, _ = s.db.ExecContext(ctx, `INSERT OR IGNORE INTO log_entries(timestamp,level,service,message,actor_type,actor_id,actor_name,workspace_id,request_id,trace_id,method,path,status,source_file,source_offset,raw_json) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, e.Timestamp.UTC().Format(time.RFC3339Nano), e.Level, e.Service, e.Message, e.ActorType, e.ActorID, e.ActorName, e.WorkspaceID, e.RequestID, e.TraceID, e.Method, e.Path, e.Status, de.Name(), offset, string(raw))
			}
			offset += int64(len(raw) + 1)
		}
		_ = file.Close()
	}
	indexRebuilds.WithLabelValues(s.service, "success").Inc()
	return nil
}
