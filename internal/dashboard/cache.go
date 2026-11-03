package dashboard

import (
	"context"
	"encoding/json"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"

	"thcpn-gin/internal/datasource/platform"
)

const statisticsTTL = 5 * time.Minute

type statisticsReader interface {
	ObservationStatistics(context.Context, uuid.UUID, time.Time, time.Time) (platform.ObservationStatistics, error)
}

type cachedStatistics struct {
	Data        platform.ObservationStatistics `json:"data"`
	AsOf        time.Time                      `json:"as_of"`
	AttemptedAt time.Time                      `json:"attempted_at"`
	Failed      bool                           `json:"failed"`
}

func (c cachedStatistics) fresh(now time.Time) bool {
	return !c.Failed && !c.AsOf.IsZero() && now.Sub(c.AsOf) < statisticsTTL && dayStart(c.AsOf).Equal(dayStart(now))
}

// Source results are cached, never a user's authorized workspace sum. Every
// request rechecks permissions and source/observation configuration versions.
// A cold or slow source does not hold the HTTP request open.
type statisticsCache struct {
	reader statisticsReader
	redis  *redis.Client
	mu     sync.Mutex
	items  map[string]cachedStatistics
	busy   map[string]bool
	slots  chan struct{}
}

func newStatisticsCache(reader statisticsReader, client *redis.Client) *statisticsCache {
	return &statisticsCache{reader: reader, redis: client, items: make(map[string]cachedStatistics), busy: make(map[string]bool), slots: make(chan struct{}, 4)}
}

func (c *statisticsCache) load(ctx context.Context, keys map[uuid.UUID]string, now time.Time) map[uuid.UUID]cachedStatistics {
	result := make(map[uuid.UUID]cachedStatistics, len(keys))
	missingIDs := make([]uuid.UUID, 0)
	missingKeys := make([]string, 0)
	c.mu.Lock()
	for id, key := range keys {
		if value, ok := c.items[key]; ok {
			result[id] = value
		} else {
			missingIDs = append(missingIDs, id)
			missingKeys = append(missingKeys, "dashboard:observations:v2:"+key)
		}
	}
	c.mu.Unlock()
	if c.redis != nil && len(missingKeys) > 0 {
		readCtx, cancel := context.WithTimeout(ctx, time.Second)
		values, err := c.redis.MGet(readCtx, missingKeys...).Result()
		cancel()
		if err == nil {
			for i, raw := range values {
				value, ok := raw.(string)
				if !ok {
					continue
				}
				var cached cachedStatistics
				if json.Unmarshal([]byte(value), &cached) == nil {
					result[missingIDs[i]] = cached
					c.store(keys[missingIDs[i]], cached)
				}
			}
		}
	}
	for id, key := range keys {
		cached := result[id]
		if !cached.fresh(now) && (cached.AttemptedAt.IsZero() || now.Sub(cached.AttemptedAt) >= time.Minute) {
			c.refresh(id, key, cached, now)
		}
	}
	return result
}

func (c *statisticsCache) store(key string, value cachedStatistics) {
	c.mu.Lock()
	defer c.mu.Unlock()
	// The shared Redis copy survives this bounded in-process cache.
	if len(c.items) >= 2048 {
		var oldestKey string
		var oldest time.Time
		for candidate, entry := range c.items {
			if oldestKey == "" || entry.AttemptedAt.Before(oldest) {
				oldestKey, oldest = candidate, entry.AttemptedAt
			}
		}
		delete(c.items, oldestKey)
	}
	c.items[key] = value
}

func (c *statisticsCache) refresh(id uuid.UUID, key string, previous cachedStatistics, now time.Time) {
	c.mu.Lock()
	if c.busy[key] {
		c.mu.Unlock()
		return
	}
	select {
	case c.slots <- struct{}{}:
		c.busy[key] = true
	default:
		c.mu.Unlock()
		return
	}
	c.mu.Unlock()
	go func() {
		defer func() {
			c.mu.Lock()
			delete(c.busy, key)
			c.mu.Unlock()
			<-c.slots
		}()
		ctx, cancel := context.WithTimeout(context.Background(), time.Minute)
		defer cancel()
		// Coalesce refreshes across API processes as well as within this one.
		if c.redis != nil {
			lockCtx, lockCancel := context.WithTimeout(ctx, time.Second)
			lockKey, token := "dashboard:observations:lock:v2:"+key, uuid.NewString()
			locked, err := c.redis.SetNX(lockCtx, lockKey, token, 70*time.Second).Result()
			lockCancel()
			if err == nil && !locked {
				// A peer owns this refresh. Drop the local copy so the next poll
				// reads its completed Redis result instead of keeping stale data.
				c.mu.Lock()
				delete(c.items, key)
				c.mu.Unlock()
				return
			}
			if err == nil {
				defer func() {
					cleanup, done := context.WithTimeout(context.Background(), time.Second)
					defer done()
					c.redis.Eval(cleanup, `if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) end return 0`, []string{lockKey}, token)
				}()
			}
		}
		value, err := c.reader.ObservationStatistics(ctx, id, dayStart(now).AddDate(0, 0, -29), now)
		entry := previous
		entry.AttemptedAt, entry.Failed = now, err != nil
		if err == nil {
			entry.Data, entry.AsOf = value, now
		}
		c.store(key, entry)
		if c.redis != nil {
			if raw, err := json.Marshal(entry); err == nil {
				writeCtx, done := context.WithTimeout(context.Background(), time.Second)
				defer done()
				c.redis.Set(writeCtx, "dashboard:observations:v2:"+key, raw, 24*time.Hour)
			}
		}
	}()
}
