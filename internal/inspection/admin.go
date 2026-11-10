package inspection

import (
	"context"
	"errors"
	"math"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"thcpn-gin/internal/apperr"
	"thcpn-gin/internal/auth"
	"thcpn-gin/internal/httpx"
)

const templateFields = `id,family,device_type,metric_code,unit,kind,lower_value,upper_value,invalid_value,consecutive,enabled,updated_at`

func (s *Service) Templates(ctx context.Context) ([]Template, error) {
	rows, err := s.DB.Query(ctx, "SELECT "+templateFields+" FROM device_inspection_templates ORDER BY family,metric_code,unit,kind")
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := []Template{}
	for rows.Next() {
		var t Template
		if err := rows.Scan(&t.ID, &t.Family, &t.DeviceType, &t.Code, &t.Unit, &t.Kind, &t.Lower, &t.Upper, &t.Invalid, &t.Consecutive, &t.Enabled, &t.Updated); err != nil {
			return nil, err
		}
		result = append(result, t)
	}
	return result, rows.Err()
}

func validTemplate(t Template) bool {
	if (t.Family != "thcpn" && t.Family != "carbon") || t.Code == "" || len(t.Code) > 120 || len(t.Unit) > 32 || t.Consecutive < 2 || t.Consecutive > 100 {
		return false
	}
	for _, v := range []*float64{t.Lower, t.Upper, t.Invalid} {
		if v != nil && (math.IsNaN(*v) || math.IsInf(*v, 0)) {
			return false
		}
	}
	switch t.DeviceType {
	case "all", "standalone", "gateway", "gateway_node":
	default:
		return false
	}
	switch t.Kind {
	case "range":
		return t.Invalid == nil && (t.Lower != nil || t.Upper != nil) && (t.Lower == nil || t.Upper == nil || *t.Lower < *t.Upper)
	case "invalid":
		return t.Invalid != nil && t.Lower == nil && t.Upper == nil
	case "zero":
		return t.Lower == nil && t.Upper == nil && t.Invalid == nil
	}
	return false
}

func (s *Service) ListTemplates(c *gin.Context) {
	items, err := s.Templates(c.Request.Context())
	if writeError(c, err) {
		return
	}
	c.JSON(http.StatusOK, gin.H{"items": items})
}

func (s *Service) SaveTemplate(c *gin.Context) {
	var t Template
	if c.ShouldBindJSON(&t) != nil {
		invalid(c, "巡检模板格式无效")
		return
	}
	if t.DeviceType == "" {
		t.DeviceType = "all"
	}
	if t.Family == "carbon" {
		t.DeviceType = "all"
	}
	t.Code, t.Unit = strings.ToLower(strings.TrimSpace(t.Code)), strings.TrimSpace(t.Unit)
	if !validTemplate(t) {
		invalid(c, "请检查指标编码、单位、上下限或连续采样次数（2–100）")
		return
	}
	ctx := c.Request.Context()
	tx, err := s.DB.Begin(ctx)
	if writeError(c, err) {
		return
	}
	defer tx.Rollback(ctx)
	if t.ID == uuid.Nil {
		err = tx.QueryRow(ctx, `INSERT INTO device_inspection_templates(family,device_type,metric_code,unit,kind,lower_value,upper_value,invalid_value,consecutive,enabled)
 VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT(family,device_type,metric_code,unit,kind) DO NOTHING RETURNING id,updated_at`,
			t.Family, t.DeviceType, t.Code, t.Unit, t.Kind, t.Lower, t.Upper, t.Invalid, t.Consecutive, t.Enabled).Scan(&t.ID, &t.Updated)
		if errors.Is(err, pgx.ErrNoRows) {
			invalid(c, "此数据源和指标已存在同类模板，请编辑现有模板")
			return
		}
	} else {
		err = tx.QueryRow(ctx, `UPDATE device_inspection_templates SET lower_value=$7,upper_value=$8,invalid_value=$9,consecutive=$10,enabled=$11,updated_at=now()
 WHERE id=$1 AND family=$2 AND device_type=$3 AND metric_code=$4 AND unit=$5 AND kind=$6 RETURNING updated_at`,
			t.ID, t.Family, t.DeviceType, t.Code, t.Unit, t.Kind, t.Lower, t.Upper, t.Invalid, t.Consecutive, t.Enabled).Scan(&t.Updated)
		if errors.Is(err, pgx.ErrNoRows) {
			httpx.WriteAppError(c, apperr.New(apperr.KindNotFound, "未找到模板，不能修改指标标识"))
			return
		}
	}
	if writeError(c, err) {
		return
	}
	if writeError(c, tx.Commit(ctx)) {
		return
	}
	c.JSON(http.StatusOK, t)
}

type DeviceCheck struct {
	DeviceID      uuid.UUID  `json:"device_id"`
	Name          string     `json:"name"`
	AssetNo       string     `json:"asset_no"`
	Family        string     `json:"family"`
	CheckedAt     *time.Time `json:"checked_at"`
	Latest        *time.Time `json:"latest_sample_at"`
	ScheduleKnown bool       `json:"schedule_known"`
	Overdue       bool       `json:"overdue"`
	Error         string     `json:"error"`
}

func (s *Service) Devices(c *gin.Context) {
	state := c.DefaultQuery("state", "attention")
	switch state {
	case "all", "attention", "error", "unknown", "pending", "overdue":
	default:
		invalid(c, "巡检状态无效")
		return
	}
	ctx := c.Request.Context()
	rows, err := s.DB.Query(ctx, eligible+`
 SELECT e.id,e.name,e.asset_no,e.family,st.checked_at,st.latest_sample_at,COALESCE(st.schedule_known,false),COALESCE(st.error,''),COALESCE(st.next_check_at < now()-interval '5 minutes',false),count(*) OVER()
 FROM eligible e LEFT JOIN device_inspection_state st ON st.device_id=e.id
 WHERE ($1='all' OR ($1='attention' AND (st.checked_at IS NULL OR NOT st.schedule_known OR st.error<>'' OR st.next_check_at < now()-interval '5 minutes')) OR
 ($1='overdue' AND st.next_check_at < now()-interval '5 minutes') OR ($1='error' AND st.error<>'') OR ($1='pending' AND st.checked_at IS NULL) OR ($1='unknown' AND st.checked_at IS NOT NULL AND NOT st.schedule_known))
 AND ($2='' OR e.name ILIKE '%'||$2||'%' OR e.asset_no ILIKE '%'||$2||'%')
 ORDER BY st.checked_at DESC NULLS FIRST,e.name,e.id LIMIT 50 OFFSET $3`, state, search(c), offset(c))
	if writeError(c, err) {
		return
	}
	defer rows.Close()
	items := []DeviceCheck{}
	var total int
	for rows.Next() {
		var d DeviceCheck
		if writeError(c, rows.Scan(&d.DeviceID, &d.Name, &d.AssetNo, &d.Family, &d.CheckedAt, &d.Latest, &d.ScheduleKnown, &d.Error, &d.Overdue, &total)) {
			return
		}
		items = append(items, d)
	}
	if writeError(c, rows.Err()) {
		return
	}
	c.JSON(http.StatusOK, gin.H{"items": items, "total": total})
}

func (s *Service) Overview(c *gin.Context) {
	ctx := c.Request.Context()
	day := c.DefaultQuery("date", time.Now().In(beijing).Format(time.DateOnly))
	start, err := time.ParseInLocation(time.DateOnly, day, beijing)
	if err != nil {
		invalid(c, "汇总日期格式应为 YYYY-MM-DD")
		return
	}
	stats := make(map[string]int)
	var covered, checked, unknown, failed, overdue, created, recovered, open int
	err = s.DB.QueryRow(ctx, eligible+`
 SELECT count(*),count(st.checked_at),count(*) FILTER(WHERE st.checked_at IS NOT NULL AND NOT st.schedule_known),
 count(*) FILTER(WHERE st.error<>''),count(*) FILTER(WHERE st.next_check_at < now()-interval '5 minutes')
 FROM eligible e LEFT JOIN device_inspection_state st ON st.device_id=e.id`).Scan(&covered, &checked, &unknown, &failed, &overdue)
	if writeError(c, err) {
		return
	}
	err = s.DB.QueryRow(ctx, eligible+`
 SELECT count(*) FILTER(WHERE detected_at >= $1 AND detected_at < $2),
 count(*) FILTER(WHERE resolved_at >= $1 AND resolved_at < $2),
 count(*) FILTER(WHERE resolved_at IS NULL AND acknowledged_at IS NULL AND x.device_id IN (SELECT id FROM eligible) AND (x.kind IN ('late','missing') OR EXISTS (SELECT 1 FROM device_inspection_templates t WHERE t.id::text=split_part(x.event_key,':',2) AND t.enabled)))
 FROM device_inspection_events x`, start, start.AddDate(0, 0, 1)).Scan(&created, &recovered, &open)
	if writeError(c, err) {
		return
	}
	stats["eligible"], stats["checked"], stats["unknown_schedule"], stats["failed"] = covered, checked, unknown, failed
	stats["overdue"] = overdue
	stats["new_events"], stats["resolved_events"], stats["unacknowledged"] = created, recovered, open
	c.JSON(http.StatusOK, gin.H{"date": day, "counts": stats})
}

type Event struct {
	ID             uuid.UUID  `json:"id"`
	DeviceID       uuid.UUID  `json:"device_id"`
	DeviceName     string     `json:"device_name"`
	AssetNo        string     `json:"asset_no"`
	Family         string     `json:"family"`
	Kind           string     `json:"kind"`
	Metric         string     `json:"metric"`
	StreamID       *uuid.UUID `json:"data_stream_id"`
	Node           *int       `json:"node_index"`
	Detail         string     `json:"detail"`
	Started        time.Time  `json:"started_at"`
	LastSeen       time.Time  `json:"last_seen_at"`
	Resolved       *time.Time `json:"resolved_at"`
	Acknowledged   *time.Time `json:"acknowledged_at"`
	AcknowledgedBy string     `json:"acknowledged_by"`
	Note           string     `json:"note"`
}

func (s *Service) Events(c *gin.Context) {
	status := c.DefaultQuery("status", "pending")
	switch status {
	case "pending", "active", "all", "resolved":
	default:
		invalid(c, "事件状态无效")
		return
	}
	rows, err := s.DB.Query(c.Request.Context(), eligible+`
 SELECT x.id,x.device_id,d.name,d.asset_no,COALESCE((SELECT src.source_family FROM device_source_refs ref JOIN data_sources src ON src.id=ref.data_source_id
 WHERE ref.device_id=d.id ORDER BY (ref.status='active') DESC,ref.updated_at DESC LIMIT 1),''),
 x.kind,x.metric,(SELECT ds.id FROM data_streams ds WHERE ds.device_id=x.device_id
   AND ds.id::text=CASE WHEN x.kind='missing' THEN split_part(x.event_key,':',2)
   WHEN x.kind IN ('range','invalid','zero') THEN split_part(x.event_key,':',3) ELSE '' END LIMIT 1),x.node_index,x.detail,x.started_at,x.last_seen_at,x.resolved_at,x.acknowledged_at,COALESCE(a.name,''),x.note,count(*) OVER()
 FROM device_inspection_events x JOIN devices d ON d.id=x.device_id LEFT JOIN system_admins a ON a.id=x.acknowledged_by
 WHERE ($1='all' OR ($1='resolved' AND x.resolved_at IS NOT NULL) OR
 ($1 IN ('pending','active') AND x.resolved_at IS NULL AND x.device_id IN (SELECT id FROM eligible) AND ($1='active' OR x.acknowledged_at IS NULL)
 AND (x.kind IN ('late','missing') OR EXISTS (SELECT 1 FROM device_inspection_templates t WHERE t.id::text=split_part(x.event_key,':',2) AND t.enabled))))
 AND ($2='' OR d.name ILIKE '%'||$2||'%' OR d.asset_no ILIKE '%'||$2||'%' OR x.metric ILIKE '%'||$2||'%')
 ORDER BY x.started_at DESC,x.id LIMIT 50 OFFSET $3`, status, search(c), offset(c))
	if writeError(c, err) {
		return
	}
	defer rows.Close()
	items := []Event{}
	var total int
	for rows.Next() {
		var e Event
		if writeError(c, rows.Scan(&e.ID, &e.DeviceID, &e.DeviceName, &e.AssetNo, &e.Family, &e.Kind, &e.Metric, &e.StreamID, &e.Node, &e.Detail, &e.Started, &e.LastSeen, &e.Resolved, &e.Acknowledged, &e.AcknowledgedBy, &e.Note, &total)) {
			return
		}
		items = append(items, e)
	}
	if writeError(c, rows.Err()) {
		return
	}
	c.JSON(http.StatusOK, gin.H{"items": items, "total": total})
}

func (s *Service) Acknowledge(c *gin.Context) {
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		invalid(c, "事件 ID 无效")
		return
	}
	actor, ok := auth.ActorFromContext(c)
	if !ok || !actor.IsSystemAdministrator() {
		c.AbortWithStatus(http.StatusForbidden)
		return
	}
	var body struct {
		Note string `json:"note"`
	}
	if c.ShouldBindJSON(&body) != nil || len([]rune(body.Note)) > 500 {
		invalid(c, "备注不能超过 500 字")
		return
	}
	tag, err := s.DB.Exec(c.Request.Context(), `UPDATE device_inspection_events SET acknowledged_at=now(),acknowledged_by=$2,note=$3
 WHERE id=$1 AND acknowledged_at IS NULL`, id, actor.SystemAdministratorID(), strings.TrimSpace(body.Note))
	if writeError(c, err) {
		return
	}
	if tag.RowsAffected() == 0 {
		invalid(c, "事件不存在或已确认，请刷新")
		return
	}
	c.Status(http.StatusNoContent)
}

func search(c *gin.Context) string { return strings.TrimSpace(c.Query("q")) }
func offset(c *gin.Context) int {
	page, _ := strconv.Atoi(c.Query("page"))
	return (max(1, min(10000, page)) - 1) * 50
}
func invalid(c *gin.Context, message string) {
	httpx.WriteAppError(c, apperr.New(apperr.KindInvalidArgument, message))
}
func writeError(c *gin.Context, err error) bool {
	if err == nil {
		return false
	}
	httpx.WriteAppError(c, apperr.Wrap(apperr.KindInternal, "巡检请求失败", err))
	return true
}

type Metric struct {
	Family string `json:"family"`
	Code   string `json:"metric_code"`
	Unit   string `json:"unit"`
	Name   string `json:"name"`
}

func (s *Service) Metrics(c *gin.Context) {
	items := []Metric{{"thcpn", "device_battery", "V", "设备电压"}, {"thcpn", "device_signal", "", "设备信号（原始值）"},
		{"carbon", "nee", carbonFluxUnit, "NEE"}, {"carbon", "er", carbonFluxUnit, "ER"}, {"carbon", "gpp", carbonFluxUnit, "GPP"}}
	rows, err := s.DB.Query(c.Request.Context(), `SELECT lower(trim(ds.code)),COALESCE(ds.unit,''),min(ds.name) FROM data_streams ds
 JOIN data_stream_bindings b ON b.data_stream_id=ds.id WHERE ds.type='telemetry' AND ds.status='active' AND ds.purpose='measurement'
 AND b.adapter_code='thcpn_legacy_mysql' AND b.status='active' GROUP BY 1,2 ORDER BY 3,1`)
	if writeError(c, err) {
		return
	}
	defer rows.Close()
	for rows.Next() {
		m := Metric{Family: "thcpn"}
		if writeError(c, rows.Scan(&m.Code, &m.Unit, &m.Name)) {
			return
		}
		items = append(items, m)
	}
	if writeError(c, rows.Err()) {
		return
	}
	c.JSON(http.StatusOK, gin.H{"items": items})
}
