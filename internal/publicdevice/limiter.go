package publicdevice

import (
	"context"
	"fmt"
	"sync"
	"time"

	"github.com/redis/go-redis/v9"
)

type localLimit struct {
	count   int64
	expires time.Time
}
type limiter struct {
	redis *redis.Client
	mu    sync.Mutex
	local map[string]localLimit
}

func newLimiter(client *redis.Client) *limiter {
	return &limiter{redis: client, local: make(map[string]localLimit)}
}

func (l *limiter) allow(ctx context.Context, key string, maximum int64, window time.Duration) bool {
	key = "public-device:" + key
	if l.redis != nil {
		count, err := l.redis.Incr(ctx, key).Result()
		if err == nil {
			if count == 1 {
				_ = l.redis.Expire(ctx, key, window).Err()
			}
			return count <= maximum
		}
	}
	l.mu.Lock()
	defer l.mu.Unlock()
	now := time.Now()
	item := l.local[key]
	if item.expires.Before(now) {
		item = localLimit{expires: now.Add(window)}
	}
	item.count++
	l.local[key] = item
	return item.count <= maximum
}

func requestLimitKey(slug, ip string) string  { return fmt.Sprintf("request:%s:%s", slug, ip) }
func passwordLimitKey(slug, ip string) string { return fmt.Sprintf("password:%s:%s", slug, ip) }
