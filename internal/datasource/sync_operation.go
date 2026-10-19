package datasource

import (
	"context"
	"encoding/json"
	"thcpn-gin/internal/apperr"
	platform "thcpn-gin/internal/datasource/platform"

	"github.com/google/uuid"
)

func (s *Service) SetSyncClaimEnsurer(ensurer interface {
	EnsureEligible(context.Context) (int64, error)
}) {
	s.ClaimEnsurer = ensurer
}
func (s *Service) SetSyncQueue(queue platform.SyncQueue) { s.SyncQueue = queue }
func (s *Service) StartSourceSync(ctx context.Context, sourceID, actorID uuid.UUID) (platform.SourceOperation, error) {
	if s.SyncQueue == nil {
		return platform.SourceOperation{}, apperr.New(apperr.KindInternal, "source sync worker queue is not configured")
	}
	source, err := s.GetDataSource(ctx, sourceID)
	if err != nil {
		return platform.SourceOperation{}, err
	}
	if source.Status != "active" {
		return platform.SourceOperation{}, apperr.New(apperr.KindInvalidArgument, "data source is disabled")
	}
	if source.SourceFamily == nil || s.modules[*source.SourceFamily].SyncAll == nil {
		return platform.SourceOperation{}, unsupportedCapability()
	}

	id, err := s.BeginSourceOperation(ctx, sourceID, nil, "sync_all", "queued", map[string]string{}, actorID)
	if err != nil {
		return platform.SourceOperation{}, err
	}
	if err = s.SyncQueue.EnqueueSourceSync(ctx, id); err != nil {
		_ = s.FinishSourceOperation(id, "failed", nil, err)
		return platform.SourceOperation{}, err
	}
	return s.GetSourceOperation(ctx, id)
}

// Syncs only source metadata; a retried worker never repeats control writes.
func (s *Service) RunSourceSync(ctx context.Context, id uuid.UUID) error {
	var sourceID, actorID uuid.UUID
	err := s.DB.QueryRow(ctx, `UPDATE source_operations SET status='running',updated_at=now() WHERE id=$1 AND kind='sync_all' AND status IN ('queued','running') RETURNING data_source_id,actor_id`, id).Scan(&sourceID, &actorID)
	if err != nil {
		op, e := s.GetSourceOperation(ctx, id)
		if e == nil && op.Status != "queued" && op.Status != "running" {
			return nil
		}
		return err
	}
	ctx = context.WithValue(ctx, platform.SyncProgressKey{}, func(result any) { _ = s.FinishSourceOperation(id, "running", result, nil) })
	source, err := s.GetDataSource(ctx, sourceID)
	var result any
	if err == nil && source.SourceFamily == nil {
		err = apperr.New(apperr.KindInvalidArgument, "source family is required")
	}
	if err == nil {
		if source.Status != "active" {
			err = apperr.New(apperr.KindInvalidArgument, "data source is disabled")
		} else if syncAll := s.modules[*source.SourceFamily].SyncAll; syncAll != nil {
			result, err = syncAll(ctx, sourceID, actorID)
		} else {
			err = unsupportedCapability()
		}
	}

	if err == nil && s.ClaimEnsurer != nil {
		_, err = s.ClaimEnsurer.EnsureEligible(ctx)
	}
	status := "completed"
	raw, _ := json.Marshal(result)
	var counts struct {
		Failed         int `json:"failed"`
		TopologyFailed int `json:"topology_failed"`
	}
	_ = json.Unmarshal(raw, &counts)
	if err != nil {
		status = "failed"
	} else if counts.Failed > 0 || counts.TopologyFailed > 0 {
		status = "partial"
	}
	if finishErr := s.FinishSourceOperation(id, status, result, err); finishErr != nil {
		return finishErr
	}
	return nil
}
