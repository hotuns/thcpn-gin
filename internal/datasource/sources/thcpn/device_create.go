package thcpn

import (
	"context"
	"strings"
	"thcpn-gin/internal/apperr"
	platform "thcpn-gin/internal/datasource/platform"
	"thcpn-gin/internal/db/sqlc"
	"unicode/utf8"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

func (s *Service) createTHCPNSourceDevice(ctx context.Context, source sqlc.DataSource, input platform.CreateSourceDeviceInput) (int64, string, error) {
	name, iccid, version := strings.TrimSpace(input.Name), strings.TrimSpace(input.ICCID), strings.TrimSpace(input.Version)
	if version == "" {
		version = "2.0"
	}
	if name == "" || !utf8.ValidString(name) || utf8.RuneCountInString(name) > 255 {
		return 0, "", apperr.New(apperr.KindInvalidArgument, "invalid thcpn device name")
	}
	if !utf8.ValidString(iccid) || utf8.RuneCountInString(iccid) > 50 {
		return 0, "", apperr.New(apperr.KindInvalidArgument, "invalid iccid")
	}
	if version != "1.0" && version != "2.0" {
		return 0, "", apperr.New(apperr.KindInvalidArgument, "invalid thcpn version")
	}
	deviceType := "0"
	if input.SourceKind == platform.CreatedSourceDeviceTHCPNGateway {
		deviceType = "10"
	} else if input.SourceKind == platform.CreatedSourceDeviceTHCPNNode {
		deviceType = "11"
	}
	db, err := s.Runtime.OpenMySQL(ctx, platform.DataSourceFromSQL(source))
	if err != nil {
		return 0, "", err
	}
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return 0, "", apperr.Wrap(apperr.KindDataSource, "begin thcpn device creation", err)
	}
	committed := false
	defer func() {
		if !committed {
			_ = tx.Rollback()
		}
	}()
	created, err := tx.ExecContext(ctx, `INSERT INTO devices (name, iccid, version, status, device_type, avatar, sn) VALUES (?, ?, ?, 'normal', ?, '', '')`, name, iccid, version, deviceType)
	if err != nil {
		return 0, "", apperr.Wrap(apperr.KindDataSource, "insert thcpn device", err)
	}
	id, err := created.LastInsertId()
	if err != nil {
		return 0, "", apperr.Wrap(apperr.KindDataSource, "read thcpn device id", err)
	}
	sn := platform.CreatedSourceDeviceSN("thcreate.v1.", id)
	if _, err := tx.ExecContext(ctx, `UPDATE devices SET sn = ? WHERE id = ?`, sn, id); err != nil {
		return 0, "", apperr.Wrap(apperr.KindDataSource, "set thcpn device sn", err)
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO device_config (device_id, data, image, control, version, uuid, is_mg) VALUES (?, '[]', '[]', '{}', ?, ?, 0)`, id, version, uuid.NewString()); err != nil {
		return 0, "", apperr.Wrap(apperr.KindDataSource, "insert thcpn device config", err)
	}
	if err := tx.Commit(); err != nil {
		return 0, "", apperr.Wrap(apperr.KindDataSource, "commit thcpn device creation", err)
	}
	committed = true
	return id, sn, nil
}
func (s *Service) syncCreatedTHCPNDevice(ctx context.Context, source sqlc.DataSource, externalID int64, deviceType string, actorID uuid.UUID) (THCPNStandardStationSyncResult, error) {
	input := thcpnDeviceSyncInput{ExternalDeviceID: externalID, DeviceType: deviceType, ActorUserID: actorID}
	if err := validateTHCPNDeviceSyncInput(input); err != nil {
		return THCPNStandardStationSyncResult{}, err
	}
	db, err := s.Runtime.OpenMySQL(ctx, platform.DataSourceFromSQL(source))
	if err != nil {
		return THCPNStandardStationSyncResult{}, err
	}
	input, err = prepareTHCPNSync(ctx, db, input)
	if err != nil {
		return THCPNStandardStationSyncResult{}, err
	}
	tx, err := s.DB.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return THCPNStandardStationSyncResult{}, apperr.Wrap(apperr.KindInternal, "begin created thcpn device sync", err)
	}
	committed := false
	defer func() {
		if !committed {
			_ = tx.Rollback(ctx)
		}
	}()
	result, err := s.syncTHCPNDevice(ctx, s.Queries.WithTx(tx), source, input)
	if err != nil {
		return THCPNStandardStationSyncResult{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return THCPNStandardStationSyncResult{}, apperr.Wrap(apperr.KindInternal, "commit created thcpn device sync", err)
	}
	committed = true
	result.Warnings = s.syncTHCPNAvatarsAfterCommit(ctx, result.Device.ID, result.ExternalDevice.AvatarURLs)
	return result, nil
}
