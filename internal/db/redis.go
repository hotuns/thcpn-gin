package db

import (
	"context"
	"errors"
	"fmt"

	"github.com/redis/go-redis/v9"

	"thcpn-gin/internal/config"
)

func NewRedis(ctx context.Context, cfg config.RedisConfig) (*redis.Client, error) {
	client := redis.NewClient(&redis.Options{
		Addr:     cfg.Addr,
		Password: cfg.Password,
		DB:       cfg.DB,
	})

	if err := PingRedis(ctx, client); err != nil {
		if closeErr := client.Close(); closeErr != nil {
			return nil, fmt.Errorf("%w; close redis: %v", err, closeErr)
		}
		return nil, err
	}

	return client, nil
}

func PingRedis(ctx context.Context, client *redis.Client) error {
	if client == nil {
		return errors.New("redis client is nil")
	}
	if err := client.Ping(ctx).Err(); err != nil {
		return fmt.Errorf("ping redis: %w", err)
	}
	return nil
}
