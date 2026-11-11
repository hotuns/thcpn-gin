package carbon

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"errors"
	"net"
	"strings"
	"time"

	"github.com/go-sql-driver/mysql"
	"github.com/google/uuid"

	"thcpn-gin/internal/apperr"
	"thcpn-gin/internal/observation"
)

// CarbonRawPeriodSamples routes an already discovered cycle by its actual time.
// It neither searches relative to today nor loads derived flux values.
func (s *Service) CarbonRawPeriodSamples(ctx context.Context, deviceID uuid.UUID, nodeID int, field string, summary CarbonPeriodSummary) ([]CarbonRawPhase, error) {
	field = strings.TrimSpace(field)
	if nodeID <= 0 || summary.NodeID != nodeID || summary.PeriodAt.IsZero() || strings.TrimSpace(summary.Period) == "" || field == "" {
		return nil, apperr.New(apperr.KindInvalidArgument, "node_id, field and discovered period are required")
	}
	if err := s.ValidateDeviceHistory(ctx, deviceID, summary.PeriodAt); err != nil {
		return nil, err
	}
	if _, _, include, err := (observation.Service{DB: s.DB}).DeviceWindow(ctx, deviceID, nodeID, summary.PeriodAt, summary.PeriodAt.Add(time.Nanosecond)); err != nil {
		return nil, err
	} else if !include {
		return nil, apperr.New(apperr.KindNotFound, "period is outside the selected observation phase")
	}
	ref, db, err := s.openCarbonDeviceSource(ctx, deviceID)
	if err != nil {
		return nil, err
	}
	// carbonMonthNames already includes both neighboring months for phases that
	// cross a month boundary; do not pad again or search relative to today.
	tables, err := carbonExistingTables(ctx, db, "device_data_next", carbonMonthNames(summary.PeriodAt, summary.PeriodAt))
	if err != nil {
		return nil, carbonRawQueryError(ctx, err, "读取碳汇原始采样数据失败")
	}
	return queryCarbonRawPhases(ctx, db, tables, ref.ExternalID, nodeID, field, summary.Period)
}

// Finish individual reads before the default driver timeout so deadline errors
// remain identifiable instead of surfacing only as mysql.ErrInvalidConn.
const carbonRawReadTimeout = 25 * time.Second

func carbonRawQueryError(ctx context.Context, err error, stage string) error {
	if contextErr := ctx.Err(); contextErr != nil && !errors.Is(err, contextErr) {
		err = errors.Join(err, contextErr)
	}
	var timeout net.Error
	switch {
	case errors.Is(err, context.DeadlineExceeded), errors.As(err, &timeout) && timeout.Timeout():
		stage = "碳汇原始数据查询超时"
	case errors.Is(err, context.Canceled):
		stage = "碳汇原始数据查询已取消"
	case errors.Is(err, mysql.ErrInvalidConn), errors.Is(err, driver.ErrBadConn), errors.Is(err, sql.ErrConnDone):
		stage = "碳汇原始数据查询连接中断"
	}
	return apperr.Wrap(apperr.KindDataSource, stage, err)
}
