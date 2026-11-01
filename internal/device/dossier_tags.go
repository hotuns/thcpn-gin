package device

import (
	"context"
	"github.com/google/uuid"
)

type AdminDeviceAsset struct {
	Device
	OpsTags []string `json:"ops_tags"`
}

func (s *Service) adminAssetTags(ctx context.Context, items []Device) ([]AdminDeviceAsset, error) {
	ids := make([]uuid.UUID, 0, len(items))
	for _, item := range items {
		ids = append(ids, item.ID)
	}
	rows, err := s.db.Query(ctx, "SELECT device_id,ops_tags FROM device_installation_records WHERE device_id=ANY($1::uuid[])", ids)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	tags := map[uuid.UUID][]string{}
	for rows.Next() {
		var id uuid.UUID
		var value []string
		if err := rows.Scan(&id, &value); err != nil {
			return nil, err
		}
		tags[id] = value
	}
	if err = rows.Err(); err != nil {
		return nil, err
	}
	result := make([]AdminDeviceAsset, 0, len(items))
	for _, item := range items {
		value := tags[item.ID]
		if value == nil {
			value = []string{}
		}
		result = append(result, AdminDeviceAsset{Device: item, OpsTags: value})
	}
	return result, nil
}
func (s *Service) workspaceDeviceTags(ctx context.Context, workspace uuid.UUID, items []Device) error {
	rows, err := s.db.Query(ctx, "SELECT device_id,tags FROM device_workspace_tags WHERE workspace_id=$1", workspace)
	if err != nil {
		return err
	}
	defer rows.Close()
	tags := map[uuid.UUID][]string{}
	for rows.Next() {
		var id uuid.UUID
		var value []string
		if err = rows.Scan(&id, &value); err != nil {
			return err
		}
		tags[id] = value
	}
	if err = rows.Err(); err != nil {
		return err
	}
	for i := range items {
		items[i].Tags = tags[items[i].ID]
	}
	return nil
}
