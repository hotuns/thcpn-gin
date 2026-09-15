package datasource

import (
	"context"
	"thcpn-gin/internal/apperr"
	"time"
)

func (s *Service) lockSourceSync(ctx context.Context, key string) (func(), error) {
	conn, err := s.db.Acquire(ctx)
	if err != nil {
		return nil, apperr.Wrap(apperr.KindInternal, "acquire source sync lock connection", err)
	}
	var acquired bool
	if err = conn.QueryRow(ctx, `SELECT pg_try_advisory_lock(hashtextextended($1,0))`, key).Scan(&acquired); err != nil {
		conn.Release()
		return nil, apperr.Wrap(apperr.KindInternal, "lock source sync", err)
	}
	if !acquired {
		conn.Release()
		return nil, apperr.New(apperr.KindConflict, "source is already synchronizing; retry after the current operation completes")
	}
	return func() {
		unlockCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		if _, err := conn.Exec(unlockCtx, `SELECT pg_advisory_unlock(hashtextextended($1,0))`, key); err != nil {
			_ = conn.Conn().Close(unlockCtx)
		}
		conn.Release()
	}, nil
}
