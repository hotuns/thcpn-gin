package export

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"time"

	"github.com/google/uuid"
	"golang.org/x/sys/unix"
	"thcpn-gin/internal/db/sqlc"
)

type progressKey struct{}
type exportProgress struct {
	bytes     atomic.Int64
	images    atomic.Int64
	uploading atomic.Bool
}

func (p *Processor) acquire(ctx context.Context) bool {
	p.limitOnce.Do(func() {
		n := p.cfg.MaxConcurrentJobs
		if n <= 0 {
			n = 1
		}
		p.slots = make(chan struct{}, n)
	})
	select {
	case p.slots <- struct{}{}:
		return true
	case <-ctx.Done():
		return false
	}
}
func (p *Processor) release() { <-p.slots }

func (p *Processor) tempDir() string {
	if p.cfg.TempDir != "" {
		return p.cfg.TempDir
	}
	return filepath.Join(os.TempDir(), "thcpn-exports")
}
func (p *Processor) minFreeBytes() uint64 {
	n := p.cfg.MinFreeMB
	if n <= 0 {
		n = 256
	}
	return uint64(n) << 20
}
func checkDisk(dir string, reserve uint64) error {
	var stat unix.Statfs_t
	if err := unix.Statfs(dir, &stat); err != nil {
		return err
	}
	if stat.Bavail*uint64(stat.Bsize) < reserve {
		return errors.New("导出临时磁盘空间不足")
	}
	return nil
}
func (p *Processor) newTempFile(id uuid.UUID) (*os.File, error) {
	dir := p.tempDir()
	if err := os.MkdirAll(dir, 0700); err != nil {
		return nil, err
	}
	if err := checkDisk(dir, p.minFreeBytes()); err != nil {
		return nil, err
	}
	return os.CreateTemp(dir, id.String()+"-*.tmp")
}

type archiveFileWriter struct {
	ctx      context.Context
	file     *os.File
	progress *exportProgress
	reserve  uint64
	checked  int64
}

func (w *archiveFileWriter) Write(b []byte) (int, error) {
	if err := w.ctx.Err(); err != nil {
		return 0, err
	}
	if w.checked <= 0 {
		if err := checkDisk(filepath.Dir(w.file.Name()), w.reserve); err != nil {
			return 0, err
		}
		w.checked = 1 << 20
	}
	n, err := w.file.Write(b)
	w.checked -= int64(n)
	w.progress.bytes.Add(int64(n))
	return n, err
}

var _ io.Writer = (*archiveFileWriter)(nil)

func (p *Processor) startHeartbeat(ctx context.Context, cancel context.CancelFunc, id uuid.UUID, progress *exportProgress) func() {
	stopped := make(chan struct{})
	done := make(chan struct{})
	go func() {
		defer close(done)
		ticker := time.NewTicker(15 * time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-stopped:
				return
			case <-ticker.C:
				stage := "packing"
				if progress.uploading.Load() {
					stage = "uploading"
				}
				raw, _ := json.Marshal(map[string]any{"stage": stage, "packed_bytes": progress.bytes.Load(), "packed_images": progress.images.Load()})
				update, c := context.WithTimeout(ctx, 5*time.Second)
				n, err := p.queries.HeartbeatExportJob(update, sqlc.HeartbeatExportJobParams{ID: id, ProgressJson: raw})
				c()
				if err != nil || n != 1 {
					cancel()
					return
				}
			}
		}
	}()
	return func() { close(stopped); <-done }
}

// Reconcile abandoned executions without replaying device reads or duplicate uploads.
// Heartbeats make this safe across worker replicas: only five-minute-old leases are failed.
func (p *Processor) RecoverInterrupted(ctx context.Context) error {
	if _, err := p.queries.FailStaleExportJobs(ctx); err != nil {
		return err
	}
	entries, err := os.ReadDir(p.tempDir())
	if os.IsNotExist(err) {
		return nil
	}
	if err != nil {
		return err
	}
	for _, entry := range entries {
		name := entry.Name()
		if entry.IsDir() || len(name) < 41 || !strings.HasSuffix(name, ".tmp") {
			continue
		}
		id, e := uuid.Parse(name[:36])
		if e != nil {
			continue
		}
		info, e := entry.Info()
		if e != nil || time.Since(info.ModTime()) < 10*time.Minute {
			continue
		}
		job, e := p.queries.GetExportJob(ctx, id)
		if e != nil {
			continue
		}
		if job.Status != "running" {
			if e = os.Remove(filepath.Join(p.tempDir(), name)); e != nil && !os.IsNotExist(e) {
				return e
			}
		}
	}
	return nil
}

func recordPackedImage(ctx context.Context) {
	if progress, ok := ctx.Value(progressKey{}).(*exportProgress); ok {
		progress.images.Add(1)
	}
}
