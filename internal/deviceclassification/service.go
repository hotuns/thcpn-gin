package deviceclassification

import (
	"context"
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	"thcpn-gin/internal/apperr"
	"thcpn-gin/internal/site"
)

var fieldNames = []string{"ecosystem"}

type SourceLocation struct {
	Latitude  *float64
	Longitude *float64
	AltitudeM *float64
}

type LocationLoader func(context.Context, []uuid.UUID) (map[uuid.UUID]SourceLocation, error)

type Service struct {
	db             *pgxpool.Pool
	locationLoader LocationLoader
}

type Term struct {
	ID            uuid.UUID  `json:"id"`
	Kind          string     `json:"kind"`
	Code          string     `json:"code"`
	NameZH        string     `json:"name_zh"`
	NameEN        string     `json:"name_en"`
	ParentID      *uuid.UUID `json:"parent_id,omitempty"`
	Status        string     `json:"status"`
	SortOrder     int        `json:"sort_order"`
	SystemDefined bool       `json:"system_defined"`
	Icon          *string    `json:"icon,omitempty"`
}

type Values struct {
	Ecosystem *Term    `json:"ecosystem,omitempty"`
	Product   *Term    `json:"product,omitempty"`
	AltitudeM *float64 `json:"altitude_m,omitempty"`
}

type Environment struct {
	DeviceID       uuid.UUID         `json:"device_id"`
	Direct         Values            `json:"direct"`
	Effective      Values            `json:"effective"`
	Overrides      []string          `json:"overridden_fields"`
	Sources        map[string]string `json:"sources"`
	ParentDeviceID *uuid.UUID        `json:"parent_device_id,omitempty"`
	SiteID         *uuid.UUID        `json:"site_id,omitempty"`
	UpdatedAt      *time.Time        `json:"updated_at,omitempty"`
}

type UpdateInput struct {
	DeviceID         uuid.UUID
	EcosystemID      *uuid.UUID
	EcosystemSet     bool
	ProductID        *uuid.UUID
	ProductSet       bool
	AltitudeM        *float64
	OverriddenFields []string
	OverriddenSet    bool
	ActorID          uuid.UUID
	ActorType        string
}

type SiteEnvironment struct {
	SiteID    uuid.UUID  `json:"site_id"`
	Values    Values     `json:"values"`
	UpdatedAt *time.Time `json:"updated_at,omitempty"`
}

type UpdateSiteInput struct {
	SiteID       uuid.UUID
	EcosystemID  *uuid.UUID
	AltitudeM    *float64
	ActorID      uuid.UUID
	ActorType    string
	AltitudeSet  bool
	EcosystemSet bool
}

type MapItem struct {
	GatewayDeviceID *uuid.UUID `json:"gateway_device_id,omitempty"`
	NodeIndex       *int       `json:"node_index,omitempty"`
	DeviceID        uuid.UUID  `json:"device_id"`
	Name            string     `json:"name"`
	AssetNo         string     `json:"asset_no"`
	NodeSN          string     `json:"node_sn,omitempty"`
	DeviceType      string     `json:"device_type"`
	Status          string     `json:"status"`
	WorkspaceID     *uuid.UUID `json:"workspace_id,omitempty"`
	SiteID          *uuid.UUID `json:"site_id,omitempty"`
	Latitude        *float64   `json:"latitude,omitempty"`
	Longitude       *float64   `json:"longitude,omitempty"`
	Tags            []string   `json:"tags,omitempty"`
	LocationSource  string     `json:"location_source"`
	ChildCount      int64      `json:"child_count"`
	Environment     Values     `json:"environment"`
}

type MapResult struct {
	Items        []MapItem `json:"items"`
	Total        int       `json:"total"`
	Located      int       `json:"located"`
	Unlocated    int       `json:"unlocated"`
	Unclassified int       `json:"unclassified"`
}

func NewService(db *pgxpool.Pool, loaders ...LocationLoader) *Service {
	service := &Service{db: db}
	if len(loaders) > 0 {
		service.locationLoader = loaders[0]
	}
	return service
}

func (s *Service) Catalog(ctx context.Context, includeInactive bool) ([]Term, error) {
	query := `SELECT id, kind, code, name_zh, name_en, parent_id, status, sort_order, system_defined, icon FROM device_taxonomy_terms`
	if !includeInactive {
		query += ` WHERE status = 'active'`
	}
	query += ` ORDER BY kind, sort_order, name_zh, id`
	rows, err := s.db.Query(ctx, query)
	if err != nil {
		return nil, apperr.Wrap(apperr.KindInternal, "list device taxonomy", err)
	}
	defer rows.Close()
	items := []Term{}
	for rows.Next() {
		var item Term
		if err := rows.Scan(&item.ID, &item.Kind, &item.Code, &item.NameZH, &item.NameEN, &item.ParentID, &item.Status, &item.SortOrder, &item.SystemDefined, &item.Icon); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func (s *Service) UpsertTerm(ctx context.Context, item Term) (Term, error) {
	item.Kind, item.Code, item.NameZH, item.NameEN = strings.TrimSpace(item.Kind), strings.TrimSpace(item.Code), strings.TrimSpace(item.NameZH), strings.TrimSpace(item.NameEN)
	if item.Kind == "" || item.Code == "" || item.NameZH == "" || item.NameEN == "" {
		return Term{}, apperr.New(apperr.KindInvalidArgument, "kind, code, Chinese name and English name are required")
	}
	if item.Kind != "ecosystem" && item.Kind != "product" {
		return Term{}, apperr.New(apperr.KindInvalidArgument, "kind must be ecosystem or product")
	}
	if item.Status == "" {
		item.Status = "active"
	}
	if item.Kind != "ecosystem" {
		item.Icon = nil
	}
	if item.ID == uuid.Nil {
		err := s.db.QueryRow(ctx, `INSERT INTO device_taxonomy_terms (kind, code, name_zh, name_en, parent_id, status, sort_order, icon) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id, system_defined`, item.Kind, item.Code, item.NameZH, item.NameEN, item.ParentID, item.Status, item.SortOrder, item.Icon).Scan(&item.ID, &item.SystemDefined)
		if err != nil {
			return Term{}, apperr.Wrap(apperr.KindInvalidArgument, "create taxonomy term", err)
		}
		return item, nil
	}
	err := s.db.QueryRow(ctx, `UPDATE device_taxonomy_terms SET name_zh=$2,name_en=$3,parent_id=$4,status=$5,sort_order=$6,icon=COALESCE($7,icon),updated_at=now() WHERE id=$1 RETURNING kind,code,system_defined,icon`, item.ID, item.NameZH, item.NameEN, item.ParentID, item.Status, item.SortOrder, item.Icon).Scan(&item.Kind, &item.Code, &item.SystemDefined, &item.Icon)
	if errors.Is(err, pgx.ErrNoRows) {
		return Term{}, apperr.New(apperr.KindNotFound, "taxonomy term not found")
	}
	if err != nil {
		return Term{}, apperr.Wrap(apperr.KindInternal, "update taxonomy term", err)
	}
	return item, nil
}

func (s *Service) DeleteTerm(ctx context.Context, id uuid.UUID) error {
	result, err := s.db.Exec(ctx, `DELETE FROM device_taxonomy_terms WHERE id=$1`, id)
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) && pgErr.Code == "23503" {
		return apperr.New(apperr.KindConflict, "taxonomy term is in use and cannot be deleted")
	}
	if err != nil {
		return apperr.Wrap(apperr.KindInternal, "delete taxonomy term", err)
	}
	if result.RowsAffected() == 0 {
		return apperr.New(apperr.KindNotFound, "taxonomy term not found")
	}
	return nil
}

func (s *Service) Get(ctx context.Context, deviceID uuid.UUID) (Environment, error) {
	result, err := s.getStored(ctx, deviceID)
	if err != nil || s.locationLoader == nil {
		return result, err
	}
	locations, err := s.locationLoader(ctx, []uuid.UUID{deviceID})
	if err != nil {
		// Live altitude is optional; site and device classification are stored locally.
		return result, ctx.Err()
	}
	if location, ok := locations[deviceID]; ok && location.AltitudeM != nil {
		result.Effective.AltitudeM = location.AltitudeM
		result.Sources["altitude_m"] = "source"
	}
	return result, nil
}

// Use the same precedence for individual device profiles and map markers.
const classificationFrom = ` FROM devices d
 LEFT JOIN device_relations rel ON rel.child_device_id=d.id AND rel.relation_type='gateway_node' AND rel.status='active'
 LEFT JOIN devices gateway ON gateway.id=rel.parent_device_id
 LEFT JOIN device_assignments own ON own.device_id=d.id AND own.status='active'
 LEFT JOIN device_assignments parent_assignment ON parent_assignment.device_id=gateway.id AND parent_assignment.status='active'
 LEFT JOIN sites st ON st.id=COALESCE(own.site_id,parent_assignment.site_id)
 LEFT JOIN device_taxonomy_terms eco ON eco.id=COALESCE(d.ecosystem_term_id,gateway.ecosystem_term_id,st.ecosystem_term_id)
 LEFT JOIN device_taxonomy_terms product ON product.id=d.product_term_id`

func (s *Service) getStored(ctx context.Context, deviceID uuid.UUID) (Environment, error) {
	result := Environment{DeviceID: deviceID, Overrides: []string{}, Sources: map[string]string{"product": "none"}}
	var ecosystemSource string
	err := s.db.QueryRow(ctx, `SELECT gateway.id, st.id, d.updated_at, row_to_json(eco), row_to_json(product), st.altitude_m,
   CASE WHEN d.ecosystem_term_id IS NOT NULL THEN 'device' WHEN gateway.ecosystem_term_id IS NOT NULL THEN 'gateway'
        WHEN st.ecosystem_term_id IS NOT NULL THEN 'site' ELSE 'none' END`+classificationFrom+` WHERE d.id=$1`, deviceID).
		Scan(&result.ParentDeviceID, &result.SiteID, &result.UpdatedAt, &result.Effective.Ecosystem, &result.Direct.Product, &result.Effective.AltitudeM, &ecosystemSource)
	if errors.Is(err, pgx.ErrNoRows) {
		return Environment{}, apperr.New(apperr.KindNotFound, "device not found")
	}
	if err != nil {
		return Environment{}, apperr.Wrap(apperr.KindInternal, "load device classification", err)
	}
	result.Sources["ecosystem"] = ecosystemSource
	if ecosystemSource == "device" {
		result.Direct.Ecosystem = result.Effective.Ecosystem
		result.Overrides = append(result.Overrides, "ecosystem")
	}
	result.Effective.Product = result.Direct.Product
	if result.Direct.Product != nil {
		result.Sources["product"] = "device"
	}
	if result.Effective.AltitudeM != nil {
		result.Sources["altitude_m"] = "site"
	}
	return result, nil
}

func (s *Service) Update(ctx context.Context, input UpdateInput) (Environment, error) {
	if input.DeviceID == uuid.Nil || input.ActorID == uuid.Nil {
		return Environment{}, apperr.New(apperr.KindInvalidArgument, "device and actor are required")
	}
	if input.OverriddenSet {
		if _, err := normalizeFields(input.OverriddenFields); err != nil {
			return Environment{}, err
		}
	}
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return Environment{}, err
	}
	defer tx.Rollback(ctx)

	var currentEcosystem, currentProduct *uuid.UUID
	if err := tx.QueryRow(ctx, `SELECT ecosystem_term_id, product_term_id FROM devices WHERE id=$1 FOR UPDATE`, input.DeviceID).Scan(&currentEcosystem, &currentProduct); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return Environment{}, apperr.New(apperr.KindNotFound, "device not found")
		}
		return Environment{}, apperr.Wrap(apperr.KindInternal, "load device classification", err)
	}

	nextEcosystem := currentEcosystem
	if input.OverriddenSet {
		overrideEco := false
		for _, field := range input.OverriddenFields {
			if field == "ecosystem" {
				overrideEco = true
				break
			}
		}
		if overrideEco {
			nextEcosystem = input.EcosystemID
		} else {
			nextEcosystem = nil
		}
	} else if input.EcosystemSet {
		nextEcosystem = input.EcosystemID
	}

	nextProduct := currentProduct
	if input.ProductSet {
		nextProduct = input.ProductID
	}

	if nextEcosystem != nil && (currentEcosystem == nil || *nextEcosystem != *currentEcosystem) {
		if err := validateTerm(ctx, tx, nextEcosystem, "ecosystem"); err != nil {
			return Environment{}, err
		}
	}
	if nextProduct != nil && (currentProduct == nil || *nextProduct != *currentProduct) {
		if err := validateTerm(ctx, tx, nextProduct, "product"); err != nil {
			return Environment{}, err
		}
	}
	if _, err := tx.Exec(ctx, `UPDATE devices SET ecosystem_term_id=$2, product_term_id=$3, updated_at=now() WHERE id=$1`, input.DeviceID, nextEcosystem, nextProduct); err != nil {
		return Environment{}, apperr.Wrap(apperr.KindInternal, "save device classification", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return Environment{}, err
	}
	return s.Get(ctx, input.DeviceID)
}

func (s *Service) GetSite(ctx context.Context, siteID uuid.UUID) (SiteEnvironment, error) {
	result := SiteEnvironment{SiteID: siteID}
	err := s.db.QueryRow(ctx, `SELECT row_to_json(eco), st.altitude_m, st.updated_at FROM sites st
 LEFT JOIN device_taxonomy_terms eco ON eco.id=st.ecosystem_term_id WHERE st.id=$1`, siteID).
		Scan(&result.Values.Ecosystem, &result.Values.AltitudeM, &result.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return SiteEnvironment{}, apperr.New(apperr.KindNotFound, "site not found")
	}
	return result, err
}

func (s *Service) UpdateSite(ctx context.Context, input UpdateSiteInput) (SiteEnvironment, error) {
	if input.SiteID == uuid.Nil || input.ActorID == uuid.Nil {
		return SiteEnvironment{}, apperr.New(apperr.KindInvalidArgument, "site and actor are required")
	}
	_, err := site.NewService(s.db).Update(ctx, site.UpdateInput{
		SiteID: input.SiteID, EcosystemTermID: input.EcosystemID, EcosystemTermIDSet: input.EcosystemSet,
		AltitudeM: input.AltitudeM, AltitudeMSet: input.AltitudeSet,
	})
	if err != nil {
		return SiteEnvironment{}, err
	}
	return s.GetSite(ctx, input.SiteID)
}

const deviceMapQuery = `SELECT d.id,d.name,COALESCE(d.asset_no,''),d.device_type,d.status,COALESCE(own.workspace_id,parent_assignment.workspace_id),st.id,
 CASE WHEN dp.latitude IS NOT NULL AND dp.longitude IS NOT NULL THEN dp.latitude WHEN st.longitude IS NOT NULL THEN st.latitude END,
 CASE WHEN dp.latitude IS NOT NULL AND dp.longitude IS NOT NULL THEN dp.longitude WHEN st.latitude IS NOT NULL THEN st.longitude END,
 CASE WHEN dp.latitude IS NOT NULL AND dp.longitude IS NOT NULL THEN 'device' WHEN st.latitude IS NOT NULL AND st.longitude IS NOT NULL THEN 'site' ELSE 'none' END,
 (SELECT count(*) FROM device_relations cr WHERE cr.parent_device_id=d.id AND cr.relation_type='gateway_node' AND cr.status='active'),
 row_to_json(eco), row_to_json(product), st.altitude_m, wt.tags` + classificationFrom + `
 LEFT JOIN device_profiles dp ON dp.device_id=d.id
 LEFT JOIN device_workspace_tags wt ON wt.device_id=d.id AND wt.workspace_id=$1
 WHERE ($1::uuid IS NULL OR COALESCE(own.workspace_id,parent_assignment.workspace_id)=$1) AND ($2 OR d.device_type <> 'gateway_node')
	ORDER BY d.name,d.id`

func (s *Service) Map(ctx context.Context, workspaceID *uuid.UUID, includeChildren bool) (MapResult, error) {
	rows, err := s.db.Query(ctx, deviceMapQuery, workspaceID, includeChildren)
	if err != nil {
		return MapResult{}, apperr.Wrap(apperr.KindInternal, "list device map", err)
	}
	defer rows.Close()
	result := MapResult{Items: []MapItem{}}
	deviceIDs := make([]uuid.UUID, 0)
	for rows.Next() {
		var item MapItem
		if err := rows.Scan(&item.DeviceID, &item.Name, &item.AssetNo, &item.DeviceType, &item.Status, &item.WorkspaceID, &item.SiteID, &item.Latitude, &item.Longitude, &item.LocationSource, &item.ChildCount, &item.Environment.Ecosystem, &item.Environment.Product, &item.Environment.AltitudeM, &item.Tags); err != nil {
			return MapResult{}, err
		}
		result.Items = append(result.Items, item)
		deviceIDs = append(deviceIDs, item.DeviceID)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return MapResult{}, err
	}
	rows.Close()
	sourceDeviceIDs := make([]uuid.UUID, 0, len(deviceIDs))
	for _, item := range result.Items {
		if item.LocationSource != "device" {
			sourceDeviceIDs = append(sourceDeviceIDs, item.DeviceID)
		}
	}
	if s.locationLoader != nil && len(sourceDeviceIDs) > 0 {
		locations, err := s.locationLoader(ctx, sourceDeviceIDs)
		if err != nil && ctx.Err() != nil {
			return MapResult{}, ctx.Err()
		}
		// Missing live positions leave the preloaded installation or site coordinates in place.
		for index := range result.Items {
			location, ok := locations[result.Items[index].DeviceID]
			if !ok {
				continue
			}
			if location.Latitude != nil && location.Longitude != nil && result.Items[index].LocationSource != "device" {
				result.Items[index].Latitude = location.Latitude
				result.Items[index].Longitude = location.Longitude
				result.Items[index].LocationSource = "source"
			}
			if location.AltitudeM != nil {
				result.Items[index].Environment.AltitudeM = location.AltitudeM
			}
		}
	}
	if includeChildren {
		if err := s.appendIndexedNodeLocations(ctx, &result, deviceIDs); err != nil {
			return MapResult{}, err
		}
	}
	recount(&result)
	return result, nil
}

func (s *Service) appendIndexedNodeLocations(ctx context.Context, result *MapResult, ids []uuid.UUID) error {
	parents := map[uuid.UUID]MapItem{}
	for _, item := range result.Items {
		parents[item.DeviceID] = item
	}
	rows, err := s.db.Query(ctx, `SELECT DISTINCT p.device_id,p.node_index,p.name,p.latitude,p.longitude,COALESCE(n.asset_no,''),n.sn FROM node_profiles p
 JOIN lorawan_physical_nodes n ON n.gateway_device_id=p.device_id AND n.node_index=p.node_index
 JOIN device_source_refs r ON r.device_id=p.device_id AND r.adapter_code='lorawan_v2' AND r.status='active'

 WHERE p.device_id=ANY($1::uuid[]) AND p.latitude IS NOT NULL AND p.longitude IS NOT NULL AND p.node_index BETWEEN 1 AND 254 ORDER BY p.device_id,p.node_index`, ids)
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		var id uuid.UUID
		var index int
		var name string
		var lat, lon *float64
		var assetNo, sn string
		if err := rows.Scan(&id, &index, &name, &lat, &lon, &assetNo, &sn); err != nil {
			return err
		}
		item := parents[id]
		item.GatewayDeviceID = &id
		item.NodeIndex = &index
		item.DeviceID = uuid.NewSHA1(id, []byte(fmt.Sprintf("node:%d", index)))
		if name == "" {
			name = fmt.Sprintf("节点 %d", index)
		}
		item.Name = name
		item.AssetNo, item.NodeSN = assetNo, sn
		item.DeviceType = "gateway_node"
		item.Latitude = lat
		item.Longitude = lon
		item.LocationSource = "node"
		item.ChildCount = 0
		item.Environment.Product = nil
		item.Tags = nil
		result.Items = append(result.Items, item)
	}
	return rows.Err()
}

func (s *Service) MapDemo(ctx context.Context, userID uuid.UUID, includeChildren bool) (MapResult, error) {
	result, err := s.Map(ctx, nil, includeChildren)
	if err != nil {
		return MapResult{}, err
	}
	rows, err := s.db.Query(ctx, `SELECT dsd.device_id,dsd.site_id,st.latitude,st.longitude FROM demo_showcase_devices dsd LEFT JOIN sites st ON st.id=dsd.site_id WHERE dsd.user_id=$1`, userID)
	if err != nil {
		return MapResult{}, apperr.Wrap(apperr.KindInternal, "list demo map devices", err)
	}
	defer rows.Close()
	type placement struct {
		siteID              *uuid.UUID
		latitude, longitude *float64
	}
	selected := map[uuid.UUID]placement{}
	for rows.Next() {
		var deviceID uuid.UUID
		var item placement
		if err := rows.Scan(&deviceID, &item.siteID, &item.latitude, &item.longitude); err != nil {
			return MapResult{}, err
		}
		selected[deviceID] = item
	}
	if err := rows.Err(); err != nil {
		return MapResult{}, err
	}
	items := make([]MapItem, 0, len(selected))
	for _, item := range result.Items {
		lookupID := item.DeviceID
		if item.GatewayDeviceID != nil {
			lookupID = *item.GatewayDeviceID
		}
		placement, ok := selected[lookupID]
		if ok {
			item.SiteID = placement.siteID
			if item.NodeIndex == nil && placement.latitude != nil && placement.longitude != nil {
				item.Latitude = placement.latitude
				item.Longitude = placement.longitude
				item.LocationSource = "site"
			}
			items = append(items, item)
		}
	}
	result.Items = items
	recount(&result)
	return result, nil
}

func normalizeFields(values []string) ([]string, error) {
	allowed := map[string]bool{}
	for _, v := range fieldNames {
		allowed[v] = true
	}
	seen := map[string]bool{}
	out := []string{}
	for _, v := range values {
		if !allowed[v] {
			return nil, apperr.New(apperr.KindInvalidArgument, "invalid overridden field")
		}
		if !seen[v] {
			seen[v] = true
			out = append(out, v)
		}
	}
	sort.Strings(out)
	return out, nil
}

func validateTerm(ctx context.Context, tx pgx.Tx, id *uuid.UUID, expectedKind string) error {
	if id == nil {
		return nil
	}
	var kind string
	if err := tx.QueryRow(ctx, `SELECT kind FROM device_taxonomy_terms WHERE id=$1 AND status='active'`, *id).Scan(&kind); err != nil || kind != expectedKind {
		return apperr.New(apperr.KindInvalidArgument, "invalid taxonomy term")
	}
	return nil
}
