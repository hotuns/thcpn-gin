package wallboard

import (
	"context"
	"embed"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"thcpn-gin/internal/apperr"
	"thcpn-gin/internal/datasource"
	"thcpn-gin/internal/media"
	"thcpn-gin/internal/telemetry"
)

//go:embed templates/*.json
var templateFiles embed.FS

type Template struct {
	Code                  string          `json:"code"`
	Version               int             `json:"version"`
	ComponentKey          string          `json:"component_key"`
	Name                  string          `json:"name"`
	Description           string          `json:"description"`
	Cover                 string          `json:"cover"`
	Scene                 string          `json:"scene"`
	DefaultRefreshSeconds int             `json:"default_refresh_seconds"`
	ConfigSchema          json.RawMessage `json:"config_schema"`
	SampleData            json.RawMessage `json:"sample_data"`
	Status                string          `json:"status"`
	Tier                  string          `json:"tier"`
	DisplayPrice          string          `json:"display_price"`
	ContactCopy           string          `json:"contact_copy"`
	CanCreate             bool            `json:"can_create"`
}

type Wallboard struct {
	ID              uuid.UUID       `json:"id"`
	WorkspaceID     uuid.UUID       `json:"workspace_id"`
	Name            string          `json:"name"`
	TemplateCode    string          `json:"template_code"`
	TemplateVersion int             `json:"template_version"`
	TemplateName    string          `json:"template_name"`
	ComponentKey    string          `json:"component_key"`
	Config          json.RawMessage `json:"config"`
	Status          string          `json:"status"`
	CreatedBy       uuid.UUID       `json:"created_by"`
	CreatedAt       time.Time       `json:"created_at"`
	UpdatedAt       time.Time       `json:"updated_at"`
}

type Config struct {
	DeviceID           *uuid.UUID  `json:"device_id"`
	SiteID             *uuid.UUID  `json:"site_id"`
	DeviceIDs          []uuid.UUID `json:"device_ids"`
	TelemetryStreamIDs []uuid.UUID `json:"telemetry_stream_ids"`
	ImageStreamIDs     []uuid.UUID `json:"image_stream_ids"`
	ComparisonStreamID *uuid.UUID  `json:"comparison_stream"`
	TrendHours         int         `json:"trend_hours"`
}
type Device struct {
	ID             uuid.UUID  `json:"id"`
	Name           string     `json:"name"`
	Status         string     `json:"status"`
	DeviceType     string     `json:"device_type"`
	SiteID         *uuid.UUID `json:"site_id,omitempty"`
	SiteName       string     `json:"site_name,omitempty"`
	Latitude       *float64   `json:"latitude,omitempty"`
	Longitude      *float64   `json:"longitude,omitempty"`
	LocationSource string     `json:"location_source"`
	Battery        *float64   `json:"battery,omitempty"`
	Signal         *float64   `json:"signal,omitempty"`
	LastReportedAt *time.Time `json:"last_reported_at,omitempty"`
	RuntimeError   string     `json:"runtime_error,omitempty"`
}
type Site struct {
	ID        uuid.UUID `json:"id"`
	Name      string    `json:"name"`
	Latitude  *float64  `json:"latitude,omitempty"`
	Longitude *float64  `json:"longitude,omitempty"`
}
type Metric struct {
	DataStreamID uuid.UUID         `json:"data_stream_id"`
	DeviceID     uuid.UUID         `json:"device_id"`
	Name         string            `json:"name"`
	Unit         *string           `json:"unit,omitempty"`
	LatestValue  *float64          `json:"latest_value,omitempty"`
	LatestAt     *time.Time        `json:"latest_at,omitempty"`
	Points       []telemetry.Point `json:"points"`
}
type ImageStream struct {
	DataStreamID uuid.UUID    `json:"data_stream_id"`
	Name         string       `json:"name"`
	Items        []media.Item `json:"items"`
}
type Snapshot struct {
	GeneratedAt time.Time `json:"generated_at"`
	Workspace   struct {
		ID   uuid.UUID `json:"id"`
		Name string    `json:"name"`
	} `json:"workspace"`
	Sites   []Site        `json:"sites"`
	Devices []Device      `json:"devices"`
	Metrics []Metric      `json:"metrics"`
	Images  []ImageStream `json:"images"`
}

type Service struct {
	db         *pgxpool.Pool
	telemetry  *telemetry.Service
	media      *media.Service
	datasource *datasource.Service
}

func NewService(db *pgxpool.Pool, telemetryService *telemetry.Service, mediaService *media.Service, datasourceService *datasource.Service) *Service {
	return &Service{db: db, telemetry: telemetryService, media: mediaService, datasource: datasourceService}
}

func catalog() ([]Template, error) {
	entries, err := templateFiles.ReadDir("templates")
	if err != nil {
		return nil, err
	}
	items := make([]Template, 0, len(entries))
	for _, entry := range entries {
		b, err := templateFiles.ReadFile("templates/" + entry.Name())
		if err != nil {
			return nil, err
		}
		var item Template
		if err = json.Unmarshal(b, &item); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	sort.Slice(items, func(i, j int) bool { return items[i].Code < items[j].Code })
	return items, nil
}

func (s *Service) Sync(ctx context.Context) error {
	items, err := catalog()
	if err != nil {
		return apperr.Wrap(apperr.KindInternal, "read wallboard templates", err)
	}
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return apperr.Wrap(apperr.KindInternal, "begin template sync", err)
	}
	defer tx.Rollback(ctx)
	for _, item := range items {
		manifest, _ := json.Marshal(item)
		_, err = tx.Exec(ctx, `INSERT INTO wallboard_templates(code,current_version) VALUES($1,$2) ON CONFLICT(code) DO UPDATE SET current_version=GREATEST(wallboard_templates.current_version,EXCLUDED.current_version),updated_at=now()`, item.Code, item.Version)
		if err != nil {
			return apperr.Wrap(apperr.KindInternal, "sync wallboard template", err)
		}
		_, err = tx.Exec(ctx, `INSERT INTO wallboard_template_versions(template_code,version,manifest_json,config_schema_json,sample_data_json) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`, item.Code, item.Version, manifest, item.ConfigSchema, item.SampleData)
		if err != nil {
			return apperr.Wrap(apperr.KindInternal, "sync wallboard template version", err)
		}
	}
	if err = tx.Commit(ctx); err != nil {
		return apperr.Wrap(apperr.KindInternal, "commit template sync", err)
	}
	return nil
}

func (s *Service) Templates(ctx context.Context, admin bool) ([]Template, error) {
	where := "WHERE t.status='published'"
	if admin {
		where = ""
	}
	rows, err := s.db.Query(ctx, `SELECT t.code,t.current_version,t.status,t.tier,t.display_price,t.contact_copy,v.manifest_json,v.config_schema_json,v.sample_data_json FROM wallboard_templates t JOIN wallboard_template_versions v ON v.template_code=t.code AND v.version=t.current_version `+where+` ORDER BY t.code`)
	if err != nil {
		return nil, apperr.Wrap(apperr.KindInternal, "list wallboard templates", err)
	}
	defer rows.Close()
	var items []Template
	for rows.Next() {
		var item Template
		var manifest []byte
		var code, status, tier, displayPrice, contactCopy string
		var version int
		if err = rows.Scan(&code, &version, &status, &tier, &displayPrice, &contactCopy, &manifest, &item.ConfigSchema, &item.SampleData); err != nil {
			return nil, apperr.Wrap(apperr.KindInternal, "scan wallboard template", err)
		}
		if err = json.Unmarshal(manifest, &item); err != nil {
			return nil, apperr.Wrap(apperr.KindInternal, "decode wallboard template", err)
		}
		applyTemplateSettings(&item, code, version, status, tier, displayPrice, contactCopy)
		item.CanCreate = item.Tier == "free"
		items = append(items, item)
	}
	return items, rows.Err()
}

func applyTemplateSettings(item *Template, code string, version int, status, tier, displayPrice, contactCopy string) {
	item.Code = code
	item.Version = version
	item.Status = status
	item.Tier = tier
	item.DisplayPrice = displayPrice
	item.ContactCopy = contactCopy
}

func (s *Service) Template(ctx context.Context, code string, publishedOnly bool) (Template, error) {
	items, err := s.Templates(ctx, !publishedOnly)
	if err != nil {
		return Template{}, err
	}
	for _, item := range items {
		if item.Code == code {
			return item, nil
		}
	}
	return Template{}, apperr.New(apperr.KindNotFound, "wallboard template not found")
}

func (s *Service) UpdateTemplate(ctx context.Context, code, status, tier, price, copy string) (Template, error) {
	if status != "published" && status != "unpublished" {
		return Template{}, apperr.New(apperr.KindInvalidArgument, "invalid template status")
	}
	if tier != "free" && tier != "premium" {
		return Template{}, apperr.New(apperr.KindInvalidArgument, "invalid template tier")
	}
	result, err := s.db.Exec(ctx, `UPDATE wallboard_templates SET status=$2,tier=$3,display_price=$4,contact_copy=$5,updated_at=now() WHERE code=$1`, code, status, tier, strings.TrimSpace(price), strings.TrimSpace(copy))
	if err != nil {
		return Template{}, apperr.Wrap(apperr.KindInternal, "update wallboard template", err)
	}
	if result.RowsAffected() == 0 {
		return Template{}, apperr.New(apperr.KindNotFound, "wallboard template not found")
	}
	return s.Template(ctx, code, false)
}

func (s *Service) List(ctx context.Context, workspaceID uuid.UUID) ([]Wallboard, error) {
	rows, err := s.db.Query(ctx, wallboardSelect+` WHERE w.workspace_id=$1 ORDER BY w.updated_at DESC`, workspaceID)
	if err != nil {
		return nil, apperr.Wrap(apperr.KindInternal, "list wallboards", err)
	}
	defer rows.Close()
	items := make([]Wallboard, 0)
	for rows.Next() {
		item, err := scanWallboard(rows)
		if err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}
func (s *Service) Get(ctx context.Context, workspaceID, id uuid.UUID) (Wallboard, error) {
	row := s.db.QueryRow(ctx, wallboardSelect+` WHERE w.workspace_id=$1 AND w.id=$2`, workspaceID, id)
	return scanWallboard(row)
}

const wallboardSelect = `SELECT w.id,w.workspace_id,w.name,w.template_code,w.template_version,(v.manifest_json->>'name'),(v.manifest_json->>'component_key'),w.config_json,w.status,w.created_by,w.created_at,w.updated_at FROM wallboards w JOIN wallboard_template_versions v ON v.template_code=w.template_code AND v.version=w.template_version`

type scanner interface{ Scan(...any) error }

func scanWallboard(row scanner) (Wallboard, error) {
	var item Wallboard
	err := row.Scan(&item.ID, &item.WorkspaceID, &item.Name, &item.TemplateCode, &item.TemplateVersion, &item.TemplateName, &item.ComponentKey, &item.Config, &item.Status, &item.CreatedBy, &item.CreatedAt, &item.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return Wallboard{}, apperr.New(apperr.KindNotFound, "wallboard not found")
	}
	if err != nil {
		return Wallboard{}, apperr.Wrap(apperr.KindInternal, "read wallboard", err)
	}
	return item, nil
}

func (s *Service) Save(ctx context.Context, workspaceID, actorID, id uuid.UUID, name, templateCode string, raw json.RawMessage) (Wallboard, error) {
	name = strings.TrimSpace(name)
	if name == "" {
		return Wallboard{}, apperr.New(apperr.KindInvalidArgument, "wallboard name is required")
	}
	var template Template
	var err error
	if id == uuid.Nil {
		template, err = s.Template(ctx, templateCode, true)
		if err != nil {
			return Wallboard{}, err
		}
		if !template.CanCreate {
			return Wallboard{}, apperr.New(apperr.KindPermissionDenied, "premium wallboard template is preview only")
		}
	} else {
		current, getErr := s.Get(ctx, workspaceID, id)
		if getErr != nil {
			return Wallboard{}, getErr
		}
		template, err = s.templateVersion(ctx, current.TemplateCode, current.TemplateVersion)
		if err != nil {
			return Wallboard{}, err
		}
	}
	config, err := s.validateConfig(ctx, workspaceID, template.Scene, raw)
	if err != nil {
		return Wallboard{}, err
	}
	encoded, _ := json.Marshal(config)
	if id == uuid.Nil {
		id = uuid.New()
		_, err = s.db.Exec(ctx, `INSERT INTO wallboards(id,workspace_id,name,template_code,template_version,config_json,created_by) VALUES($1,$2,$3,$4,$5,$6,$7)`, id, workspaceID, name, template.Code, template.Version, encoded, actorID)
	} else {
		result, e := s.db.Exec(ctx, `UPDATE wallboards SET name=$3,config_json=$4,updated_at=now() WHERE workspace_id=$1 AND id=$2 AND status='active'`, workspaceID, id, name, encoded)
		err = e
		if err == nil && result.RowsAffected() == 0 {
			return Wallboard{}, apperr.New(apperr.KindNotFound, "wallboard not found")
		}
	}
	if err != nil {
		return Wallboard{}, apperr.Wrap(apperr.KindInternal, "save wallboard", err)
	}
	return s.Get(ctx, workspaceID, id)
}
func (s *Service) Archive(ctx context.Context, workspaceID, id uuid.UUID) error {
	result, err := s.db.Exec(ctx, `UPDATE wallboards SET status='archived',updated_at=now() WHERE workspace_id=$1 AND id=$2`, workspaceID, id)
	if err != nil {
		return apperr.Wrap(apperr.KindInternal, "archive wallboard", err)
	}
	if result.RowsAffected() == 0 {
		return apperr.New(apperr.KindNotFound, "wallboard not found")
	}
	return nil
}

func (s *Service) validateConfig(ctx context.Context, workspaceID uuid.UUID, scene string, raw json.RawMessage) (Config, error) {
	var c Config
	if len(raw) == 0 || json.Unmarshal(raw, &c) != nil {
		return c, apperr.New(apperr.KindInvalidArgument, "invalid wallboard config")
	}
	if c.TrendHours <= 0 {
		c.TrendHours = 24
	}
	if c.TrendHours > 720 {
		return c, apperr.New(apperr.KindInvalidArgument, "trend_hours exceeds 720")
	}
	if scene == "site" && c.SiteID == nil {
		return c, apperr.New(apperr.KindInvalidArgument, "site_id is required")
	}
	if scene == "device" && c.DeviceID == nil {
		return c, apperr.New(apperr.KindInvalidArgument, "device_id is required")
	}
	if scene == "organization" && len(c.DeviceIDs) > 50 {
		return c, apperr.New(apperr.KindInvalidArgument, "at most 50 device ids are allowed")
	}
	if c.SiteID != nil {
		if err := s.requireWorkspaceRow(ctx, `SELECT 1 FROM sites WHERE id=$1 AND workspace_id=$2 AND status='active'`, *c.SiteID, workspaceID); err != nil {
			return c, err
		}
	}
	ids := append([]uuid.UUID{}, c.DeviceIDs...)
	if c.DeviceID != nil {
		ids = append(ids, *c.DeviceID)
	}
	for _, id := range ids {
		if err := s.requireWorkspaceRow(ctx, `SELECT 1 FROM device_assignments WHERE device_id=$1 AND workspace_id=$2 AND status='active'`, id, workspaceID); err != nil {
			return c, err
		}
	}
	streamIDs := append(append([]uuid.UUID{}, c.TelemetryStreamIDs...), c.ImageStreamIDs...)
	if c.ComparisonStreamID != nil {
		streamIDs = append(streamIDs, *c.ComparisonStreamID)
	}
	for _, id := range streamIDs {
		if err := s.requireWorkspaceRow(ctx, `SELECT 1 FROM data_streams ds JOIN device_assignments da ON da.device_id=ds.device_id AND da.status='active' WHERE ds.id=$1 AND da.workspace_id=$2 AND ds.status='active'`, id, workspaceID); err != nil {
			return c, err
		}
	}
	return c, nil
}
func (s *Service) requireWorkspaceRow(ctx context.Context, q string, id, workspaceID uuid.UUID) error {
	var one int
	err := s.db.QueryRow(ctx, q, id, workspaceID).Scan(&one)
	if errors.Is(err, pgx.ErrNoRows) {
		return apperr.New(apperr.KindInvalidArgument, "wallboard resource does not belong to workspace")
	}
	if err != nil {
		return apperr.Wrap(apperr.KindInternal, "validate wallboard resource", err)
	}
	return nil
}

func (s *Service) Snapshot(ctx context.Context, workspaceID, id uuid.UUID) (Snapshot, error) {
	item, err := s.Get(ctx, workspaceID, id)
	if err != nil {
		return Snapshot{}, err
	}
	var cfg Config
	if json.Unmarshal(item.Config, &cfg) != nil {
		return Snapshot{}, apperr.New(apperr.KindInternal, "invalid saved wallboard config")
	}
	template, err := s.templateVersion(ctx, item.TemplateCode, item.TemplateVersion)
	if err != nil {
		return Snapshot{}, err
	}
	if _, err = s.validateConfig(ctx, workspaceID, template.Scene, item.Config); err != nil {
		return Snapshot{}, err
	}
	return s.buildSnapshot(ctx, workspaceID, cfg)
}
func (s *Service) templateVersion(ctx context.Context, code string, version int) (Template, error) {
	var manifest []byte
	var t Template
	err := s.db.QueryRow(ctx, `SELECT manifest_json FROM wallboard_template_versions WHERE template_code=$1 AND version=$2`, code, version).Scan(&manifest)
	if errors.Is(err, pgx.ErrNoRows) {
		return t, apperr.New(apperr.KindNotFound, "wallboard template version not found")
	}
	if err != nil {
		return t, apperr.Wrap(apperr.KindInternal, "read wallboard template version", err)
	}
	if json.Unmarshal(manifest, &t) != nil {
		return t, apperr.New(apperr.KindInternal, "invalid wallboard template version")
	}
	return t, nil
}

func (s *Service) buildSnapshot(ctx context.Context, workspaceID uuid.UUID, cfg Config) (Snapshot, error) {
	out := Snapshot{
		Sites:   make([]Site, 0),
		Devices: make([]Device, 0),
		Metrics: make([]Metric, 0),
		Images:  make([]ImageStream, 0),
	}
	out.GeneratedAt = time.Now().UTC()
	if err := s.db.QueryRow(ctx, `SELECT id,name FROM workspaces WHERE id=$1 AND status='active'`, workspaceID).Scan(&out.Workspace.ID, &out.Workspace.Name); err != nil {
		return out, apperr.Wrap(apperr.KindInternal, "read wallboard workspace", err)
	}
	siteRows, err := s.db.Query(ctx, `SELECT id,name,latitude,longitude FROM sites WHERE workspace_id=$1 AND status='active' ORDER BY name`, workspaceID)
	if err != nil {
		return out, err
	}
	for siteRows.Next() {
		var v Site
		if err = siteRows.Scan(&v.ID, &v.Name, &v.Latitude, &v.Longitude); err != nil {
			siteRows.Close()
			return out, err
		}
		out.Sites = append(out.Sites, v)
	}
	siteRows.Close()
	deviceSQL := `SELECT d.id,d.name,d.status,d.device_type,da.site_id,COALESCE(s.name,''),s.latitude,s.longitude FROM devices d JOIN device_assignments da ON da.device_id=d.id AND da.status='active' LEFT JOIN sites s ON s.id=da.site_id WHERE da.workspace_id=$1`
	args := []any{workspaceID}
	if cfg.SiteID != nil {
		deviceSQL += ` AND da.site_id=$2`
		args = append(args, *cfg.SiteID)
	} else if cfg.DeviceID != nil {
		deviceSQL += ` AND d.id=$2`
		args = append(args, *cfg.DeviceID)
	} else if len(cfg.DeviceIDs) > 0 {
		deviceSQL += ` AND d.id=ANY($2)`
		args = append(args, cfg.DeviceIDs)
	}
	deviceSQL += ` ORDER BY d.name`
	rows, err := s.db.Query(ctx, deviceSQL, args...)
	if err != nil {
		return out, apperr.Wrap(apperr.KindInternal, "list wallboard devices", err)
	}
	for rows.Next() {
		var v Device
		if err = rows.Scan(&v.ID, &v.Name, &v.Status, &v.DeviceType, &v.SiteID, &v.SiteName, &v.Latitude, &v.Longitude); err != nil {
			rows.Close()
			return out, err
		}
		out.Devices = append(out.Devices, v)
	}
	rows.Close()
	if s.datasource != nil && len(out.Devices) > 0 {
		deviceIDs := make([]uuid.UUID, 0, len(out.Devices))
		for _, device := range out.Devices {
			deviceIDs = append(deviceIDs, device.ID)
		}
		runtime, runtimeErr := s.datasource.THCPNDeviceRuntime(ctx, deviceIDs)
		if runtimeErr == nil {
			applyRuntime(&out, runtime)
		} else {
			for i := range out.Devices {
				out.Devices[i].RuntimeError = apperr.MessageOf(runtimeErr)
			}
		}
	}
	start := out.GeneratedAt.Add(-time.Duration(cfg.TrendHours) * time.Hour)
	metricStreamIDs := cfg.TelemetryStreamIDs
	if cfg.ComparisonStreamID != nil {
		deviceIDs := make([]uuid.UUID, 0, len(out.Devices))
		for _, device := range out.Devices {
			deviceIDs = append(deviceIDs, device.ID)
		}
		rows, queryErr := s.db.Query(ctx, `SELECT matched.id FROM data_streams selected JOIN data_streams matched ON matched.code=selected.code AND matched.type='telemetry' AND matched.status='active' WHERE selected.id=$1 AND matched.device_id=ANY($2::uuid[]) ORDER BY matched.device_id`, *cfg.ComparisonStreamID, deviceIDs)
		if queryErr != nil {
			return out, apperr.Wrap(apperr.KindInternal, "resolve comparison streams", queryErr)
		}
		metricStreamIDs = make([]uuid.UUID, 0, len(deviceIDs))
		for rows.Next() {
			var streamID uuid.UUID
			if err = rows.Scan(&streamID); err != nil {
				rows.Close()
				return out, err
			}
			metricStreamIDs = append(metricStreamIDs, streamID)
		}
		rows.Close()
	}
	for _, streamID := range metricStreamIDs {
		result, e := s.telemetry.QueryInternal(ctx, telemetry.QueryInput{DataStreamID: &streamID, StartTime: start, EndTime: out.GeneratedAt, Limit: 500})
		if e != nil {
			return out, e
		}
		for _, series := range result.Series {
			metric := Metric{DataStreamID: series.DataStreamID, Name: series.Name, Unit: series.Unit, Points: series.Points}
			_ = s.db.QueryRow(ctx, `SELECT device_id FROM data_streams WHERE id=$1`, series.DataStreamID).Scan(&metric.DeviceID)
			if len(series.Points) > 0 {
				last := series.Points[len(series.Points)-1]
				metric.LatestValue = &last.Value
				metric.LatestAt = &last.Timestamp
			}
			out.Metrics = append(out.Metrics, metric)
		}
	}
	imageStart := out.GeneratedAt.AddDate(0, 0, -7)
	for _, streamID := range cfg.ImageStreamIDs {
		var name string
		if err = s.db.QueryRow(ctx, `SELECT name FROM data_streams WHERE id=$1`, streamID).Scan(&name); err != nil {
			return out, apperr.Wrap(apperr.KindInternal, "read image stream", err)
		}
		result, e := s.media.List(ctx, media.QueryInput{DataStreamID: &streamID, MediaType: "image", StartTime: imageStart, EndTime: out.GeneratedAt, Page: 1, PageSize: 20})
		if e != nil {
			return out, e
		}
		out.Images = append(out.Images, ImageStream{DataStreamID: streamID, Name: name, Items: result.Items})
	}
	return out, nil
}

func applyRuntime(snapshot *Snapshot, runtime datasource.THCPNDeviceRuntimeBatchResponse) {
	items := make(map[uuid.UUID]datasource.THCPNLatestAttributesResponse, len(runtime.Items))
	failures := make(map[uuid.UUID]string, len(runtime.Failures))
	for _, item := range runtime.Items {
		items[item.DeviceID] = item
	}
	for _, failure := range runtime.Failures {
		failures[failure.DeviceID] = failure.Error
	}
	for i := range snapshot.Devices {
		device := &snapshot.Devices[i]
		device.LocationSource = "site"
		if item, ok := items[device.ID]; ok {
			if item.SourceDevice.Status != nil && strings.TrimSpace(*item.SourceDevice.Status) != "" {
				device.Status = strings.ToLower(strings.TrimSpace(*item.SourceDevice.Status))
			}
			if item.SourceDevice.Latitude != nil && item.SourceDevice.Longitude != nil {
				device.Latitude, device.Longitude = item.SourceDevice.Latitude, item.SourceDevice.Longitude
				device.LocationSource = "device"
			}
			device.Battery = numericAttribute(item.Attributes["battery"])
			device.Signal = numericAttribute(item.Attributes["signal"])
			device.LastReportedAt = latestRuntimeTime(item)
		}
		device.RuntimeError = failures[device.ID]
		if device.Latitude == nil || device.Longitude == nil {
			device.LocationSource = "unconfigured"
		}
	}
}

func numericAttribute(value datasource.THCPNAttributeValue) *float64 {
	if value.RawValue == "" {
		return nil
	}
	number, err := strconv.ParseFloat(strings.TrimSpace(value.RawValue), 64)
	if err != nil {
		return nil
	}
	return &number
}

func latestRuntimeTime(item datasource.THCPNLatestAttributesResponse) *time.Time {
	var latest *time.Time
	for _, value := range item.Attributes {
		candidate := value.SampledAt
		if latest == nil || candidate.After(*latest) {
			latest = &candidate
		}
	}
	if item.SourceDevice.UpdatedAt != nil && (latest == nil || item.SourceDevice.UpdatedAt.After(*latest)) {
		latest = item.SourceDevice.UpdatedAt
	}
	return latest
}

func PreviewSnapshot(template Template) (any, error) {
	var value any
	if err := json.Unmarshal(template.SampleData, &value); err != nil {
		return nil, fmt.Errorf("decode sample data: %w", err)
	}
	return value, nil
}
