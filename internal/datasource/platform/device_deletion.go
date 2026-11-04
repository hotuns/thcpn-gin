package platform

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"regexp"
	"strings"
)

type SourceDeletion struct {
	State   string   `json:"state"`
	Reasons []string `json:"reasons"`
}

func DeletionBlocked(reason string) SourceDeletion {
	return SourceDeletion{State: "blocked", Reasons: []string{reason}}
}

var sourceDeletionIdentifier = regexp.MustCompile("^[a-zA-Z0-9_]+$")

// CheckManagedMySQLDeletion checks the creation signature and the history in the
// source's own tables. It never deletes source data or removes a relationship.
func CheckManagedMySQLDeletion(ctx context.Context, db *sql.DB, id int64, prefix, configTable, defaultFields, shardPattern string, extra [][2]string, execute bool) (SourceDeletion, error) {
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return SourceDeletion{}, err
	}
	defer tx.Rollback()
	var sn string
	var deleted bool
	if err = tx.QueryRowContext(ctx, "SELECT sn, deleted_at IS NOT NULL FROM devices WHERE id=? FOR UPDATE", id).Scan(&sn, &deleted); errors.Is(err, sql.ErrNoRows) {
		return SourceDeletion{State: "absent"}, nil
	} else if err != nil {
		return SourceDeletion{}, err
	}
	if sn != CreatedSourceDeviceSN(prefix, id) {
		return DeletionBlocked("无法确认源端设备由本平台创建"), nil
	}
	if deleted {
		return SourceDeletion{State: "absent"}, nil
	}
	var configs, business int
	if err = tx.QueryRowContext(ctx, "SELECT COUNT(*), COALESCE(SUM(CASE WHEN JSON_LENGTH(data)=0 AND JSON_TYPE(data)='ARRAY' AND JSON_LENGTH(image)=0 AND JSON_TYPE(image)='ARRAY' AND JSON_LENGTH(control)=0 AND JSON_TYPE(control)='OBJECT' AND deleted_at IS NULL AND ("+defaultFields+") THEN 0 ELSE 1 END),0) FROM "+configTable+" WHERE device_id=?", id).Scan(&configs, &business); err != nil {
		return SourceDeletion{}, err
	}
	if configs > 1 || business > 0 {
		return DeletionBlocked("源端已有非默认配置或配置历史"), nil
	}

	rows, err := tx.QueryContext(ctx, `SELECT TABLE_NAME, COLUMN_NAME FROM information_schema.KEY_COLUMN_USAGE
 WHERE TABLE_SCHEMA=DATABASE() AND REFERENCED_TABLE_SCHEMA=DATABASE() AND REFERENCED_TABLE_NAME='devices' AND REFERENCED_COLUMN_NAME='id' AND TABLE_NAME<>?
 UNION
 SELECT TABLE_NAME, CASE WHEN TABLE_NAME REGEXP '^device_log(_|$)' THEN 'device' ELSE 'device_id' END
 FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME REGEXP ?`, configTable, shardPattern)
	if err != nil {
		return SourceDeletion{}, err
	}
	checks := append([][2]string{}, extra...)
	for rows.Next() {
		var pair [2]string
		if err = rows.Scan(&pair[0], &pair[1]); err != nil {
			rows.Close()
			return SourceDeletion{}, err
		}
		checks = append(checks, pair)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return SourceDeletion{}, err
	}
	for _, pair := range checks {
		if !sourceDeletionIdentifier.MatchString(pair[0]) || !sourceDeletionIdentifier.MatchString(pair[1]) {
			return SourceDeletion{}, fmt.Errorf("unsupported source table or column")
		}
		var present bool
		stmt := fmt.Sprintf("SELECT EXISTS(SELECT 1 FROM `%s` WHERE `%s`=?)", pair[0], pair[1])
		if err = tx.QueryRowContext(ctx, stmt, id).Scan(&present); err != nil {
			return SourceDeletion{}, err
		}
		if present {
			return DeletionBlocked("源端已有设备使用记录：" + strings.ReplaceAll(pair[0], "_", " ")), nil
		}
	}
	state := "eligible"
	if execute {
		if _, err = tx.ExecContext(ctx, "UPDATE devices SET deleted_at=CURRENT_TIMESTAMP WHERE id=? AND deleted_at IS NULL", id); err != nil {
			return SourceDeletion{}, err
		}
		state = "deleted"
	}
	return SourceDeletion{State: state}, tx.Commit()
}
