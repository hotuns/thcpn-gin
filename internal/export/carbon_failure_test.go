package export

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net"
	"os"
	"testing"

	"github.com/go-sql-driver/mysql"
	"github.com/google/uuid"

	"thcpn-gin/internal/apperr"
	"thcpn-gin/internal/config"
	"thcpn-gin/internal/testdb"
)

func TestCarbonQueryFailuresPersistPublicMessageAndPreserveCause(t *testing.T) {
	db := testdb.Open(t, 0)
	admin := testdb.Admin(t, db)
	deviceID := uuid.New()
	if _, err := db.Exec(t.Context(), `INSERT INTO devices(id,name,device_type) VALUES($1,'碳汇测试站','carbon_sink')`, deviceID); err != nil {
		t.Fatal(err)
	}
	tests := []struct {
		name    string
		message string
		cause   error
	}{
		{"read timeout", "碳汇原始数据查询超时", &net.OpError{Op: "read", Net: "tcp", Err: os.ErrDeadlineExceeded}},
		{"invalid connection without timeout evidence", "碳汇原始数据查询连接中断", mysql.ErrInvalidConn},
		{"period discovery failure", "查询碳汇原始采样周期失败", errors.New("source query failed")},
		{"raw detail failure", "读取碳汇原始采样数据失败", errors.New("source read failed")},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			jobID := uuid.New()
			if _, err := db.Exec(t.Context(), `INSERT INTO export_jobs(id,requested_by_admin,resource_type,resource_id,export_type,status,expires_at)
				VALUES($1,$2,'device',$3,'carbon_station_zip','running',now()+interval '1 day')`, jobID, admin, deviceID); err != nil {
				t.Fatal(err)
			}
			var output bytes.Buffer
			logger := slog.New(slog.NewJSONHandler(&output, nil))
			p := NewProcessor(db, nil, nil, nil, config.ExportConfig{}, logger)
			sourceErr := apperr.Wrap(apperr.KindDataSource, test.message, test.cause)
			// The source's execution context can already be cancelled when its
			// read times out; failure persistence must still complete.
			ctx, cancel := context.WithCancel(t.Context())
			cancel()
			got := p.fail(ctx, jobID, sourceErr)
			if got != sourceErr || !errors.Is(got, test.cause) {
				t.Fatalf("worker lost original source failure: %v", got)
			}
			if test.name == "read timeout" {
				var timeout net.Error
				if !errors.As(got, &timeout) || !timeout.Timeout() {
					t.Fatalf("worker lost typed read timeout: %v", got)
				}
			}
			job, err := p.queries.GetExportJob(t.Context(), jobID)
			if err != nil {
				t.Fatal(err)
			}
			if job.Status != "failed" || job.ErrorMessage == nil || *job.ErrorMessage != test.message {
				t.Fatalf("wrong public error persisted: status=%s message=%v", job.Status, job.ErrorMessage)
			}
			var log map[string]any
			if err := json.Unmarshal(output.Bytes(), &log); err != nil || log["reason"] != test.message {
				t.Fatalf("failure log lost the public reason: %s (%v)", output.Bytes(), err)
			}
		})
	}
}
