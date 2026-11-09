package lorawanv2

import (
	"context"
	"encoding/json"

	"github.com/google/uuid"
	"thcpn-gin/internal/apperr"
)

// ProjectNodeAssets adds platform identity without changing upstream bindings or pagination.
func (s *Service) ProjectNodeAssets(ctx context.Context, source uuid.UUID, raw json.RawMessage) (json.RawMessage, error) {
	var page map[string]json.RawMessage
	var entries []map[string]json.RawMessage
	if json.Unmarshal(raw, &page) != nil || json.Unmarshal(page["data"], &entries) != nil || entries == nil {
		return nil, apperr.New(apperr.KindDataSource, "invalid physical node inventory")
	}
	if len(entries) == 0 {
		return raw, nil
	}
	var nodes []PhysicalNode
	if err := json.Unmarshal(page["data"], &nodes); err != nil {
		return nil, err
	}
	ids := make([]int64, len(nodes))
	for i, n := range nodes {
		if n.ID <= 0 || n.SN == "" {
			return nil, apperr.New(apperr.KindDataSource, "invalid physical node identity")
		}
		ids[i] = n.ID
	}
	if _, err := s.DB.Exec(ctx, `INSERT INTO lorawan_physical_nodes(data_source_id,external_id,sn)
  SELECT $1,id,sn FROM jsonb_to_recordset($2::jsonb) AS node(id bigint,sn text)
  WHERE NOT EXISTS (SELECT 1 FROM lorawan_physical_nodes p WHERE p.data_source_id=$1 AND p.external_id=node.id)
  ON CONFLICT (data_source_id,external_id) DO NOTHING`, source, page["data"]); err != nil {
		return nil, err
	}
	rows, err := s.DB.Query(ctx, `SELECT external_id,asset_no,hardware_sn FROM lorawan_physical_nodes
  WHERE data_source_id=$1 AND external_id=ANY($2::bigint[])`, source, ids)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	type asset struct {
		number   string
		hardware *string
	}
	assets := make(map[int64]asset, len(nodes))
	for rows.Next() {
		var id int64
		var a asset
		if err := rows.Scan(&id, &a.number, &a.hardware); err != nil {
			return nil, err
		}
		assets[id] = a
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	for i, n := range nodes {
		a := assets[n.ID]
		entries[i]["asset_no"], _ = json.Marshal(a.number)
		entries[i]["hardware_sn"], _ = json.Marshal(a.hardware)
	}
	page["data"], err = json.Marshal(entries)
	if err != nil {
		return nil, err
	}
	return json.Marshal(page)
}
