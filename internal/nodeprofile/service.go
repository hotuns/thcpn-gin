package nodeprofile

import (
	"context"
	"fmt"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"strings"
	"thcpn-gin/internal/apperr"
	"unicode"
	"unicode/utf8"
)

type Reader interface {
	Query(context.Context, string, ...any) (pgx.Rows, error)
}

func Normalize(name string) (string, error) {
	for _, r := range name {
		if unicode.IsControl(r) || r == '\u2028' || r == '\u2029' {
			return "", apperr.New(apperr.KindInvalidArgument, "node name must not contain control characters or line breaks")
		}
	}
	name = strings.TrimSpace(name)
	if utf8.RuneCountInString(name) > 50 {
		return "", apperr.New(apperr.KindInvalidArgument, "node name must not exceed 50 characters")
	}
	return name, nil
}
func Label(name string, index int) string {
	if name == "" {
		return fmt.Sprintf("节点 %d", index)
	}
	return fmt.Sprintf("%s · 节点 %d", name, index)
}
func Names(ctx context.Context, db Reader, id uuid.UUID) (map[int]string, error) {
	rows, err := db.Query(ctx, "SELECT node_index,name FROM node_profiles WHERE device_id=$1", id)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := map[int]string{}
	for rows.Next() {
		var index int
		var name string
		if err = rows.Scan(&index, &name); err != nil {
			return nil, err
		}
		result[index] = name
	}
	return result, rows.Err()
}
