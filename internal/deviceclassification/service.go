package deviceclassification

import (
	"context"
	"errors"
	"sort"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"thcpn-gin/internal/apperr"
)

var fieldNames = []string{"ecosystem", "observation_objects", "purposes", "management", "deployment", "commissioned_year", "research_tags"}

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
}

type Values struct {
	Ecosystem          *Term    `json:"ecosystem,omitempty"`
	ObservationObjects []Term   `json:"observation_objects"`
	Purposes           []Term   `json:"purposes"`
	Management         *Term    `json:"management,omitempty"`
	Deployment         *Term    `json:"deployment,omitempty"`
	AltitudeM          *float64 `json:"altitude_m,omitempty"`
	CommissionedYear   *int     `json:"commissioned_year,omitempty"`
	ResearchTags       []string `json:"research_tags"`
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
	ObservationIDs   []uuid.UUID
	PurposeIDs       []uuid.UUID
	ManagementID     *uuid.UUID
	DeploymentID     *uuid.UUID
	AltitudeM        *float64
	CommissionedYear *int
	ResearchTags     []string
	OverriddenFields []string
	ActorID          uuid.UUID
	ActorType        string
}

type SiteEnvironment struct {
	SiteID    uuid.UUID  `json:"site_id"`
	Values    Values     `json:"values"`
	UpdatedAt *time.Time `json:"updated_at,omitempty"`
}

type UpdateSiteInput struct {
	SiteID           uuid.UUID
	EcosystemID      *uuid.UUID
	ObservationIDs   []uuid.UUID
	PurposeIDs       []uuid.UUID
	ManagementID     *uuid.UUID
	DeploymentID     *uuid.UUID
	AltitudeM        *float64
	CommissionedYear *int
	ResearchTags     []string
	ActorID          uuid.UUID
	ActorType        string
}

type MapItem struct {
	DeviceID       uuid.UUID  `json:"device_id"`
	Name           string     `json:"name"`
	SerialNo       string     `json:"serial_no"`
	DeviceType     string     `json:"device_type"`
	Status         string     `json:"status"`
	WorkspaceID    *uuid.UUID `json:"workspace_id,omitempty"`
	SiteID         *uuid.UUID `json:"site_id,omitempty"`
	Latitude       *float64   `json:"latitude,omitempty"`
	Longitude      *float64   `json:"longitude,omitempty"`
	LocationSource string     `json:"location_source"`
	ChildCount     int64      `json:"child_count"`
	Environment    Values     `json:"environment"`
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
	query := `SELECT id, kind, code, name_zh, name_en, parent_id, status, sort_order, system_defined FROM device_taxonomy_terms`
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
		if err := rows.Scan(&item.ID, &item.Kind, &item.Code, &item.NameZH, &item.NameEN, &item.ParentID, &item.Status, &item.SortOrder, &item.SystemDefined); err != nil {
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
	if item.Status == "" {
		item.Status = "active"
	}
	if item.ID == uuid.Nil {
		err := s.db.QueryRow(ctx, `INSERT INTO device_taxonomy_terms (kind, code, name_zh, name_en, parent_id, status, sort_order) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id, system_defined`, item.Kind, item.Code, item.NameZH, item.NameEN, item.ParentID, item.Status, item.SortOrder).Scan(&item.ID, &item.SystemDefined)
		if err != nil {
			return Term{}, apperr.Wrap(apperr.KindInvalidArgument, "create taxonomy term", err)
		}
		return item, nil
	}
	err := s.db.QueryRow(ctx, `UPDATE device_taxonomy_terms SET name_zh=$2,name_en=$3,parent_id=$4,status=$5,sort_order=$6,updated_at=now() WHERE id=$1 RETURNING kind,code,system_defined`, item.ID, item.NameZH, item.NameEN, item.ParentID, item.Status, item.SortOrder).Scan(&item.Kind, &item.Code, &item.SystemDefined)
	if errors.Is(err, pgx.ErrNoRows) {
		return Term{}, apperr.New(apperr.KindNotFound, "taxonomy term not found")
	}
	if err != nil {
		return Term{}, apperr.Wrap(apperr.KindInternal, "update taxonomy term", err)
	}
	return item, nil
}

func (s *Service) Get(ctx context.Context, deviceID uuid.UUID) (Environment, error) {
	result, err := s.getStored(ctx, deviceID)
	if err != nil || s.locationLoader == nil {
		return result, err
	}
	locations, err := s.locationLoader(ctx, []uuid.UUID{deviceID})
	if err != nil {
		return Environment{}, err
	}
	if location, ok := locations[deviceID]; ok && location.AltitudeM != nil {
		result.Effective.AltitudeM = location.AltitudeM
		result.Sources["altitude_m"] = "source"
	}
	return result, nil
}

func (s *Service) getStored(ctx context.Context, deviceID uuid.UUID) (Environment, error) {
	meta, err := s.deviceMeta(ctx, deviceID)
	if err != nil {
		return Environment{}, err
	}
	direct, overrides, updatedAt, err := s.loadDeviceValues(ctx, deviceID)
	if err != nil {
		return Environment{}, err
	}
	var inherited Values
	sources := map[string]string{}
	if meta.ParentID != nil {
		parent, err := s.getStored(ctx, *meta.ParentID)
		if err != nil {
			return Environment{}, err
		}
		inherited = parent.Effective
		for _, field := range fieldNames {
			sources[field] = "gateway"
		}
	} else if meta.SiteID != nil {
		inherited, err = s.loadSiteValues(ctx, *meta.SiteID)
		if err != nil {
			return Environment{}, err
		}
		for _, field := range fieldNames {
			sources[field] = "site"
		}
	} else {
		inherited = emptyValues()
		for _, field := range fieldNames {
			sources[field] = "none"
		}
	}
	effective := inherited
	for _, field := range overrides {
		applyField(&effective, direct, field)
		sources[field] = "device"
	}
	return Environment{DeviceID: deviceID, Direct: direct, Effective: effective, Overrides: overrides, Sources: sources, ParentDeviceID: meta.ParentID, SiteID: meta.SiteID, UpdatedAt: updatedAt}, nil
}

func (s *Service) Update(ctx context.Context, input UpdateInput) (Environment, error) {
	if input.DeviceID == uuid.Nil || input.ActorID == uuid.Nil {
		return Environment{}, apperr.New(apperr.KindInvalidArgument, "device and actor are required")
	}
	if input.ActorType != "system_admin" {
		input.ActorType = "user"
	}
	overrides, err := normalizeFields(input.OverriddenFields)
	if err != nil {
		return Environment{}, err
	}
	if input.CommissionedYear != nil && (*input.CommissionedYear < 1900 || *input.CommissionedYear > 2200) {
		return Environment{}, apperr.New(apperr.KindInvalidArgument, "commissioned year must be between 1900 and 2200")
	}
	input.ResearchTags = cleanTags(input.ResearchTags)
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return Environment{}, err
	}
	defer tx.Rollback(ctx)
	if err := validateTerms(ctx, tx, input); err != nil {
		return Environment{}, err
	}
	_, err = tx.Exec(ctx, `INSERT INTO device_environment_profiles (device_id,ecosystem_term_id,management_term_id,deployment_term_id,commissioned_year,research_tags,overridden_fields,updated_by,updated_actor_type) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (device_id) DO UPDATE SET ecosystem_term_id=EXCLUDED.ecosystem_term_id,management_term_id=EXCLUDED.management_term_id,deployment_term_id=EXCLUDED.deployment_term_id,commissioned_year=EXCLUDED.commissioned_year,research_tags=EXCLUDED.research_tags,overridden_fields=EXCLUDED.overridden_fields,updated_by=EXCLUDED.updated_by,updated_actor_type=EXCLUDED.updated_actor_type,updated_at=now()`, input.DeviceID, input.EcosystemID, input.ManagementID, input.DeploymentID, input.CommissionedYear, input.ResearchTags, overrides, input.ActorID, input.ActorType)
	if err != nil {
		return Environment{}, apperr.Wrap(apperr.KindInternal, "save device environment", err)
	}
	if _, err = tx.Exec(ctx, `DELETE FROM device_environment_terms WHERE device_id=$1`, input.DeviceID); err != nil {
		return Environment{}, err
	}
	for _, id := range append(append([]uuid.UUID{}, input.ObservationIDs...), input.PurposeIDs...) {
		if _, err = tx.Exec(ctx, `INSERT INTO device_environment_terms (device_id,term_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, input.DeviceID, id); err != nil {
			return Environment{}, err
		}
	}
	if err = tx.Commit(ctx); err != nil {
		return Environment{}, err
	}
	return s.Get(ctx, input.DeviceID)
}

func (s *Service) GetSite(ctx context.Context, siteID uuid.UUID) (SiteEnvironment, error) {
	var exists bool
	if err := s.db.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM sites WHERE id=$1)`, siteID).Scan(&exists); err != nil {
		return SiteEnvironment{}, err
	}
	if !exists {
		return SiteEnvironment{}, apperr.New(apperr.KindNotFound, "site not found")
	}
	values, err := s.loadSiteValues(ctx, siteID)
	if err != nil {
		return SiteEnvironment{}, err
	}
	var updatedAt *time.Time
	_ = s.db.QueryRow(ctx, `SELECT updated_at FROM site_environment_profiles WHERE site_id=$1`, siteID).Scan(&updatedAt)
	return SiteEnvironment{SiteID: siteID, Values: values, UpdatedAt: updatedAt}, nil
}

func (s *Service) UpdateSite(ctx context.Context, input UpdateSiteInput) (SiteEnvironment, error) {
	if input.SiteID == uuid.Nil || input.ActorID == uuid.Nil {
		return SiteEnvironment{}, apperr.New(apperr.KindInvalidArgument, "site and actor are required")
	}
	if input.ActorType != "system_admin" {
		input.ActorType = "user"
	}
	if input.CommissionedYear != nil && (*input.CommissionedYear < 1900 || *input.CommissionedYear > 2200) {
		return SiteEnvironment{}, apperr.New(apperr.KindInvalidArgument, "commissioned year must be between 1900 and 2200")
	}
	input.ResearchTags = cleanTags(input.ResearchTags)
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return SiteEnvironment{}, err
	}
	defer tx.Rollback(ctx)
	deviceInput := UpdateInput{EcosystemID: input.EcosystemID, ObservationIDs: input.ObservationIDs, PurposeIDs: input.PurposeIDs, ManagementID: input.ManagementID, DeploymentID: input.DeploymentID}
	if err := validateTerms(ctx, tx, deviceInput); err != nil {
		return SiteEnvironment{}, err
	}
	result, err := tx.Exec(ctx, `INSERT INTO site_environment_profiles (site_id,ecosystem_term_id,management_term_id,deployment_term_id,altitude_m,commissioned_year,research_tags,updated_by,updated_actor_type) SELECT $1,$2,$3,$4,$5,$6,$7,$8,$9 WHERE EXISTS (SELECT 1 FROM sites WHERE id=$1) ON CONFLICT (site_id) DO UPDATE SET ecosystem_term_id=EXCLUDED.ecosystem_term_id,management_term_id=EXCLUDED.management_term_id,deployment_term_id=EXCLUDED.deployment_term_id,altitude_m=EXCLUDED.altitude_m,commissioned_year=EXCLUDED.commissioned_year,research_tags=EXCLUDED.research_tags,updated_by=EXCLUDED.updated_by,updated_actor_type=EXCLUDED.updated_actor_type,updated_at=now()`, input.SiteID, input.EcosystemID, input.ManagementID, input.DeploymentID, input.AltitudeM, input.CommissionedYear, input.ResearchTags, input.ActorID, input.ActorType)
	if err != nil {
		return SiteEnvironment{}, apperr.Wrap(apperr.KindInternal, "save site environment", err)
	}
	if result.RowsAffected() == 0 {
		return SiteEnvironment{}, apperr.New(apperr.KindNotFound, "site not found")
	}
	if _, err = tx.Exec(ctx, `DELETE FROM site_environment_terms WHERE site_id=$1`, input.SiteID); err != nil {
		return SiteEnvironment{}, err
	}
	for _, id := range append(append([]uuid.UUID{}, input.ObservationIDs...), input.PurposeIDs...) {
		if _, err = tx.Exec(ctx, `INSERT INTO site_environment_terms (site_id,term_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, input.SiteID, id); err != nil {
			return SiteEnvironment{}, err
		}
	}
	if err = tx.Commit(ctx); err != nil {
		return SiteEnvironment{}, err
	}
	return s.GetSite(ctx, input.SiteID)
}

const deviceMapQuery = `SELECT d.id,d.name,d.serial_no,d.device_type,d.status,COALESCE(own.workspace_id,parent_assignment.workspace_id),COALESCE(own.site_id,parent_assignment.site_id),
	st.latitude,
	st.longitude,
	CASE WHEN st.latitude IS NOT NULL AND st.longitude IS NOT NULL THEN 'site' ELSE 'none' END,
	(SELECT count(*) FROM device_relations cr WHERE cr.parent_device_id=d.id AND cr.relation_type='gateway_node' AND cr.status='active')
	FROM devices d
	LEFT JOIN device_relations rel ON rel.child_device_id=d.id AND rel.relation_type='gateway_node' AND rel.status='active'
	LEFT JOIN device_assignments own ON own.device_id=d.id AND own.status='active'
	LEFT JOIN device_assignments parent_assignment ON parent_assignment.device_id=rel.parent_device_id AND parent_assignment.status='active'
	LEFT JOIN sites st ON st.id=COALESCE(own.site_id,parent_assignment.site_id)
	WHERE ($1::uuid IS NULL OR COALESCE(own.workspace_id,parent_assignment.workspace_id)=$1) AND ($2 OR d.device_type <> 'gateway_node')
	ORDER BY d.name,d.id`

func (s *Service) Map(ctx context.Context, workspaceID *uuid.UUID, includeChildren bool) (MapResult, error) {
	rows, err := s.db.Query(ctx, deviceMapQuery, workspaceID, includeChildren)
	if err != nil {
		return MapResult{}, apperr.Wrap(apperr.KindInternal, "list device map", err)
	}
	result := MapResult{Items: []MapItem{}}
	deviceIDs := make([]uuid.UUID, 0)
	for rows.Next() {
		var item MapItem
		if err := rows.Scan(&item.DeviceID, &item.Name, &item.SerialNo, &item.DeviceType, &item.Status, &item.WorkspaceID, &item.SiteID, &item.Latitude, &item.Longitude, &item.LocationSource, &item.ChildCount); err != nil {
			return MapResult{}, err
		}
		environment, envErr := s.getStored(ctx, item.DeviceID)
		if envErr != nil {
			return MapResult{}, envErr
		}
		item.Environment = environment.Effective
		result.Items = append(result.Items, item)
		deviceIDs = append(deviceIDs, item.DeviceID)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return MapResult{}, err
	}
	rows.Close()
	if s.locationLoader != nil {
		locations, err := s.locationLoader(ctx, deviceIDs)
		if err != nil {
			return MapResult{}, err
		}
		for index := range result.Items {
			location, ok := locations[result.Items[index].DeviceID]
			if !ok {
				continue
			}
			if location.Latitude != nil && location.Longitude != nil {
				result.Items[index].Latitude = location.Latitude
				result.Items[index].Longitude = location.Longitude
				result.Items[index].LocationSource = "source"
			}
			if location.AltitudeM != nil {
				result.Items[index].Environment.AltitudeM = location.AltitudeM
			}
		}
	}
	recount(&result)
	return result, nil
}

type deviceMetaResult struct{ ParentID, SiteID *uuid.UUID }

func (s *Service) deviceMeta(ctx context.Context, deviceID uuid.UUID) (deviceMetaResult, error) {
	var result deviceMetaResult
	err := s.db.QueryRow(ctx, `SELECT rel.parent_device_id,COALESCE(own.site_id,parent_assignment.site_id) FROM devices d LEFT JOIN device_relations rel ON rel.child_device_id=d.id AND rel.relation_type='gateway_node' AND rel.status='active' LEFT JOIN device_assignments own ON own.device_id=d.id AND own.status='active' LEFT JOIN device_assignments parent_assignment ON parent_assignment.device_id=rel.parent_device_id AND parent_assignment.status='active' WHERE d.id=$1`, deviceID).Scan(&result.ParentID, &result.SiteID)
	if errors.Is(err, pgx.ErrNoRows) {
		return result, apperr.New(apperr.KindNotFound, "device not found")
	}
	return result, err
}

func (s *Service) loadDeviceValues(ctx context.Context, deviceID uuid.UUID) (Values, []string, *time.Time, error) {
	values := emptyValues()
	overrides := []string{}
	var ecosystemID, managementID, deploymentID *uuid.UUID
	var updatedAt *time.Time
	err := s.db.QueryRow(ctx, `SELECT ecosystem_term_id,management_term_id,deployment_term_id,commissioned_year,research_tags,overridden_fields,updated_at FROM device_environment_profiles WHERE device_id=$1`, deviceID).Scan(&ecosystemID, &managementID, &deploymentID, &values.CommissionedYear, &values.ResearchTags, &overrides, &updatedAt)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return values, nil, nil, err
	}
	if ecosystemID != nil {
		values.Ecosystem, _ = s.term(ctx, *ecosystemID)
	}
	if managementID != nil {
		values.Management, _ = s.term(ctx, *managementID)
	}
	if deploymentID != nil {
		values.Deployment, _ = s.term(ctx, *deploymentID)
	}
	terms, err := s.entityTerms(ctx, "device_environment_terms", "device_id", deviceID)
	if err != nil {
		return values, nil, nil, err
	}
	for _, term := range terms {
		if term.Kind == "observation_object" {
			values.ObservationObjects = append(values.ObservationObjects, term)
		}
		if term.Kind == "purpose" {
			values.Purposes = append(values.Purposes, term)
		}
	}
	return values, overrides, updatedAt, nil
}

func (s *Service) loadSiteValues(ctx context.Context, siteID uuid.UUID) (Values, error) {
	values := emptyValues()
	var ecosystemID, managementID, deploymentID *uuid.UUID
	err := s.db.QueryRow(ctx, `SELECT ecosystem_term_id,management_term_id,deployment_term_id,altitude_m,commissioned_year,research_tags FROM site_environment_profiles WHERE site_id=$1`, siteID).Scan(&ecosystemID, &managementID, &deploymentID, &values.AltitudeM, &values.CommissionedYear, &values.ResearchTags)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return values, err
	}
	if ecosystemID != nil {
		values.Ecosystem, _ = s.term(ctx, *ecosystemID)
	}
	if managementID != nil {
		values.Management, _ = s.term(ctx, *managementID)
	}
	if deploymentID != nil {
		values.Deployment, _ = s.term(ctx, *deploymentID)
	}
	terms, err := s.entityTerms(ctx, "site_environment_terms", "site_id", siteID)
	if err != nil {
		return values, err
	}
	for _, term := range terms {
		if term.Kind == "observation_object" {
			values.ObservationObjects = append(values.ObservationObjects, term)
		}
		if term.Kind == "purpose" {
			values.Purposes = append(values.Purposes, term)
		}
	}
	return values, nil
}

func (s *Service) term(ctx context.Context, id uuid.UUID) (*Term, error) {
	var t Term
	err := s.db.QueryRow(ctx, `SELECT id,kind,code,name_zh,name_en,parent_id,status,sort_order,system_defined FROM device_taxonomy_terms WHERE id=$1`, id).Scan(&t.ID, &t.Kind, &t.Code, &t.NameZH, &t.NameEN, &t.ParentID, &t.Status, &t.SortOrder, &t.SystemDefined)
	if err != nil {
		return nil, err
	}
	return &t, nil
}
func (s *Service) entityTerms(ctx context.Context, table, column string, id uuid.UUID) ([]Term, error) {
	rows, err := s.db.Query(ctx, `SELECT t.id,t.kind,t.code,t.name_zh,t.name_en,t.parent_id,t.status,t.sort_order,t.system_defined FROM `+table+` et JOIN device_taxonomy_terms t ON t.id=et.term_id WHERE et.`+column+`=$1 ORDER BY t.sort_order,t.name_zh`, id)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []Term{}
	for rows.Next() {
		var t Term
		if err := rows.Scan(&t.ID, &t.Kind, &t.Code, &t.NameZH, &t.NameEN, &t.ParentID, &t.Status, &t.SortOrder, &t.SystemDefined); err != nil {
			return nil, err
		}
		items = append(items, t)
	}
	return items, rows.Err()
}

func emptyValues() Values {
	return Values{ObservationObjects: []Term{}, Purposes: []Term{}, ResearchTags: []string{}}
}
func applyField(dst *Values, src Values, field string) {
	switch field {
	case "ecosystem":
		dst.Ecosystem = src.Ecosystem
	case "observation_objects":
		dst.ObservationObjects = src.ObservationObjects
	case "purposes":
		dst.Purposes = src.Purposes
	case "management":
		dst.Management = src.Management
	case "deployment":
		dst.Deployment = src.Deployment
	case "commissioned_year":
		dst.CommissionedYear = src.CommissionedYear
	case "research_tags":
		dst.ResearchTags = src.ResearchTags
	}
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
func cleanTags(values []string) []string {
	seen := map[string]bool{}
	out := []string{}
	for _, v := range values {
		v = strings.TrimSpace(v)
		if v != "" && !seen[v] {
			seen[v] = true
			out = append(out, v)
		}
	}
	sort.Strings(out)
	return out
}
func validateTerms(ctx context.Context, tx pgx.Tx, input UpdateInput) error {
	checks := []struct {
		id   *uuid.UUID
		kind string
	}{{input.EcosystemID, "ecosystem"}, {input.ManagementID, "management"}, {input.DeploymentID, "deployment"}}
	for _, c := range checks {
		if c.id == nil {
			continue
		}
		var kind string
		if err := tx.QueryRow(ctx, `SELECT kind FROM device_taxonomy_terms WHERE id=$1 AND status='active'`, *c.id).Scan(&kind); err != nil || kind != c.kind {
			return apperr.New(apperr.KindInvalidArgument, "invalid taxonomy term")
		}
	}
	for _, pair := range []struct {
		ids  []uuid.UUID
		kind string
	}{{input.ObservationIDs, "observation_object"}, {input.PurposeIDs, "purpose"}} {
		for _, id := range pair.ids {
			var kind string
			if err := tx.QueryRow(ctx, `SELECT kind FROM device_taxonomy_terms WHERE id=$1 AND status='active'`, id).Scan(&kind); err != nil || kind != pair.kind {
				return apperr.New(apperr.KindInvalidArgument, "invalid taxonomy term")
			}
		}
	}
	return nil
}
