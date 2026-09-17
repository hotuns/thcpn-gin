package datasource

import (
	"context"
	"encoding/json"
	"github.com/google/uuid"
	"thcpn-gin/internal/apperr"
)

type SyncQueue interface {
	EnqueueSourceSync(context.Context, uuid.UUID) error
}

func (s *Service) SetSyncClaimEnsurer(ensurer interface {
	EnsureEligible(context.Context) (int64, error)
}) {
	s.claimEnsurer = ensurer
}
func (s *Service) SetSyncQueue(queue SyncQueue) { s.syncQueue = queue }

func (s *Service) StartSourceSync(ctx context.Context, sourceID, actorID uuid.UUID) (SourceOperation, error) {
	if s.syncQueue == nil {
		return SourceOperation{}, apperr.New(apperr.KindInternal, "source sync worker queue is not configured")
	}
	source, err := s.GetDataSource(ctx, sourceID)
	if err != nil {
		return SourceOperation{}, err
	}
	if source.Status != "active" {
		return SourceOperation{}, apperr.New(apperr.KindInvalidArgument, "data source is disabled")
	}
	if source.SourceFamily == nil || (*source.SourceFamily != "thcpn" && *source.SourceFamily != "carbon") {
		return SourceOperation{}, apperr.New(apperr.KindInvalidArgument, "source does not support device sync")
	}
	id, err := s.beginSourceOperation(ctx, sourceID, nil, "sync_all", "queued", map[string]string{}, actorID)
	if err != nil {
		return SourceOperation{}, err
	}
	if err = s.syncQueue.EnqueueSourceSync(ctx, id); err != nil {
		_ = s.finishSourceOperation(id, "failed", nil, err)
		return SourceOperation{}, err
	}
	return s.GetSourceOperation(ctx, id)
}

// Syncs only source metadata; a retried worker never repeats control writes.
func (s *Service) RunSourceSync(ctx context.Context, id uuid.UUID) error {
	var sourceID, actorID uuid.UUID
	err := s.db.QueryRow(ctx, `UPDATE source_operations SET status='running',updated_at=now() WHERE id=$1 AND kind='sync_all' AND status IN ('queued','running') RETURNING data_source_id,actor_id`, id).Scan(&sourceID, &actorID)
	if err != nil {
		op, e := s.GetSourceOperation(ctx, id)
		if e == nil && op.Status != "queued" && op.Status != "running" {
			return nil
		}
		return err
	}
	ctx = context.WithValue(ctx, syncProgressKey{}, func(result any) { _ = s.finishSourceOperation(id, "running", result, nil) })
	source, err := s.GetDataSource(ctx, sourceID)
	var result any
	if err == nil && source.SourceFamily == nil {
		err = apperr.New(apperr.KindInvalidArgument, "source family is required")
	}
	if err == nil {
		switch *source.SourceFamily {
		case "thcpn":
			result, err = s.SyncAllTHCPNDevices(ctx, SyncAllTHCPNDevicesInput{DataSourceID: sourceID, ActorUserID: actorID})
		case "carbon":
			result, err = s.SyncAllCarbonDevices(ctx, SyncAllCarbonDevicesInput{DataSourceID: sourceID, ActorUserID: actorID})
		default:
			err = apperr.New(apperr.KindInvalidArgument, "source does not support device sync")
		}
	}
	if err == nil && s.claimEnsurer != nil {
		_, err = s.claimEnsurer.EnsureEligible(ctx)
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
	if finishErr := s.finishSourceOperation(id, status, result, err); finishErr != nil {
		return finishErr
	}
	return nil
}

type syncProgressKey struct{}

func reportSyncProgress(ctx context.Context, result any) {
	if report, ok := ctx.Value(syncProgressKey{}).(func(any)); ok {
		report(result)
	}
}
