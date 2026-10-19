package carbon

import (
	"context"
	"math"
	"strings"
	"thcpn-gin/internal/apperr"
	platform "thcpn-gin/internal/datasource/platform"
	"thcpn-gin/internal/db/sqlc"
	"unicode/utf8"
)

func (s *Service) createCarbonSourceDevice(ctx context.Context, source sqlc.DataSource, input platform.CreateSourceDeviceInput) (int64, string, error) {
	name := strings.TrimSpace(input.Name)
	if name == "" || !utf8.ValidString(name) || utf8.RuneCountInString(name) > 32 {
		return 0, "", apperr.New(apperr.KindInvalidArgument, "invalid carbon device name")
	}
	nodesCount, err := NormalizeCarbonNodesCount(input.NodesCount)
	if err != nil {
		return 0, "", err
	}
	db, err := s.Runtime.OpenMySQLDatabase(ctx, platform.DataSourceFromSQL(source), carbonDatabaseName)
	if err != nil {
		return 0, "", err
	}
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return 0, "", apperr.Wrap(apperr.KindDataSource, "begin carbon device creation", err)
	}
	committed := false
	defer func() {
		if !committed {
			_ = tx.Rollback()
		}
	}()
	created, err := tx.ExecContext(ctx, `INSERT INTO devices (name, device_type, sn, nodes_count) VALUES (?, 'carbon-sink-v2', '', ?)`, name, nodesCount)
	if err != nil {
		return 0, "", apperr.Wrap(apperr.KindDataSource, "insert carbon device", err)
	}
	id, err := created.LastInsertId()
	if err != nil {
		return 0, "", apperr.Wrap(apperr.KindDataSource, "read carbon device id", err)
	}
	sn := platform.CreatedSourceDeviceSN("thcreate.v3.", id)
	if _, err := tx.ExecContext(ctx, `UPDATE devices SET sn = ? WHERE id = ?`, sn, id); err != nil {
		return 0, "", apperr.Wrap(apperr.KindDataSource, "set carbon device sn", err)
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO device_configs (device_id, data, image, control) VALUES (?, '[]', '[]', '{}')`, id); err != nil {
		return 0, "", apperr.Wrap(apperr.KindDataSource, "insert carbon device config", err)
	}
	if err := tx.Commit(); err != nil {
		return 0, "", apperr.Wrap(apperr.KindDataSource, "commit carbon device creation", err)
	}
	committed = true
	return id, sn, nil
}
func NormalizeCarbonNodesCount(value *int64) (int64, error) {
	if value == nil {
		return 16, nil
	}
	if *value <= 0 || *value > math.MaxUint32 {
		return 0, apperr.New(apperr.KindInvalidArgument, "invalid nodes_count")
	}
	return *value, nil
}
