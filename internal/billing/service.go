package billing

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

const (
	PlanBase         = "base"
	PlanProfessional = "professional"
)

type Policy struct {
	ProfessionalAnnualPriceCents    int64
	ProfessionalDefaultMonths       int
	BaseHistoryDays                 int
	BaseExportDays                  int
	MonthlyDownloadLimitBytes       int64
	TrafficPackSizeBytes            int64
	TrafficPackPriceCents           int64
	ExpiryNoticeDays                []int
	DownloadUsageWarningPercentages []int
}

type Service struct {
	db     *pgxpool.Pool
	policy Policy
}

type Summary struct {
	WorkspaceID                   uuid.UUID  `json:"workspace_id"`
	Plan                          string     `json:"plan"`
	ProfessionalStartedAt         *time.Time `json:"professional_started_at,omitempty"`
	ProfessionalExpiresAt         *time.Time `json:"professional_expires_at,omitempty"`
	FullHistory                   bool       `json:"full_history"`
	ProfessionalFeatures          bool       `json:"professional_features"`
	MonthlyDownloadLimitBytes     int64      `json:"monthly_download_limit_bytes"`
	MonthlyDownloadUsedBytes      int64      `json:"monthly_download_used_bytes"`
	MonthlyDownloadRemainingBytes int64      `json:"monthly_download_remaining_bytes"`
	TrafficPackBalanceBytes       int64      `json:"traffic_pack_balance_bytes"`
	UsagePercent                  float64    `json:"usage_percent"`
	WarningLevel                  int        `json:"warning_level"`
	DaysUntilExpiry               *int       `json:"days_until_expiry,omitempty"`
	Notices                       []Notice   `json:"notices"`
	ProfessionalAnnualPriceCents  int64      `json:"professional_annual_price_cents"`
	ProfessionalDefaultMonths     int        `json:"professional_default_months"`
	BaseHistoryDays               int        `json:"base_history_days"`
	BaseExportDays                int        `json:"base_export_days"`
	TrafficPackSizeBytes          int64      `json:"traffic_pack_size_bytes"`
	TrafficPackPriceCents         int64      `json:"traffic_pack_price_cents"`
}

type Notice struct {
	Code    string `json:"code"`
	Level   string `json:"level"`
	Message string `json:"message"`
}

type PlanGrant struct {
	ID           uuid.UUID `json:"id"`
	WorkspaceID  uuid.UUID `json:"workspace_id"`
	SourceType   string    `json:"source_type"`
	ReferenceNo  *string   `json:"reference_no,omitempty"`
	AmountCents  int64     `json:"amount_cents"`
	StartsAt     time.Time `json:"starts_at"`
	EndsAt       time.Time `json:"ends_at"`
	Reason       string    `json:"reason"`
	ActorAdminID uuid.UUID `json:"actor_admin_id"`
	CreatedAt    time.Time `json:"created_at"`
}

type TrafficPackGrant struct {
	ID           uuid.UUID `json:"id"`
	WorkspaceID  uuid.UUID `json:"workspace_id"`
	Bytes        int64     `json:"bytes"`
	PriceCents   int64     `json:"price_cents"`
	ReferenceNo  *string   `json:"reference_no,omitempty"`
	Reason       string    `json:"reason"`
	ActorAdminID uuid.UUID `json:"actor_admin_id"`
	CreatedAt    time.Time `json:"created_at"`
}

type History struct {
	PlanGrants        []PlanGrant        `json:"plan_grants"`
	TrafficPackGrants []TrafficPackGrant `json:"traffic_pack_grants"`
}

type RiskWorkspace struct {
	WorkspaceID   uuid.UUID `json:"workspace_id"`
	WorkspaceName string    `json:"workspace_name"`
	Summary       Summary   `json:"billing"`
	Risks         []string  `json:"risks"`
}
type GrantProfessionalInput struct {
	SourceType, ReferenceNo, Reason string
	AmountCents                     int64
	StartsAt, EndsAt                *time.Time
	DurationMonths                  int
}
type AddTrafficPackInput struct {
	Bytes, PriceCents   int64
	ReferenceNo, Reason string
}

type ReserveDownloadInput struct {
	WorkspaceID    uuid.UUID
	SourceType     string
	ResourceID     *uuid.UUID
	ObjectKey      string
	Bytes          int64
	ActorUserID    *uuid.UUID
	IdempotencyKey string
}

func NewService(db *pgxpool.Pool, policy Policy) *Service {
	policy.ExpiryNoticeDays = append([]int(nil), policy.ExpiryNoticeDays...)
	policy.DownloadUsageWarningPercentages = append([]int(nil), policy.DownloadUsageWarningPercentages...)
	sort.Sort(sort.Reverse(sort.IntSlice(policy.ExpiryNoticeDays)))
	sort.Ints(policy.DownloadUsageWarningPercentages)
	return &Service{db: db, policy: policy}
}

func (s *Service) BaseHistoryDays() int { return s.policy.BaseHistoryDays }
func (s *Service) BaseExportDays() int  { return s.policy.BaseExportDays }

func monthStart(now time.Time) time.Time {
	y, m, _ := now.UTC().Date()
	return time.Date(y, m, 1, 0, 0, 0, 0, time.UTC)
}

func (s *Service) Summary(ctx context.Context, workspaceID uuid.UUID) (Summary, error) {
	if workspaceID == uuid.Nil {
		return Summary{}, apperr.New(apperr.KindInvalidArgument, "workspace id is required")
	}
	now := time.Now().UTC()
	month := monthStart(now)
	var started, expires *time.Time
	var pack, used int64
	err := s.db.QueryRow(ctx, `
		SELECT a.professional_started_at, a.professional_expires_at,
			COALESCE(a.traffic_pack_balance_bytes, 0),
			COALESCE((SELECT sum(u.monthly_bytes) FROM workspace_download_usage u WHERE u.workspace_id=$1 AND u.usage_month=$2), 0)
		FROM workspaces w LEFT JOIN workspace_billing_accounts a ON a.workspace_id=w.id WHERE w.id=$1
	`, workspaceID, month).Scan(&started, &expires, &pack, &used)
	if errors.Is(err, pgx.ErrNoRows) {
		return Summary{}, apperr.New(apperr.KindNotFound, "workspace not found")
	}
	if err != nil {
		return Summary{}, apperr.Wrap(apperr.KindInternal, "load workspace billing", err)
	}
	return s.makeSummary(workspaceID, started, expires, pack, used, now), nil
}

func (s *Service) makeSummary(workspaceID uuid.UUID, started, expires *time.Time, pack, used int64, now time.Time) Summary {
	professional := started != nil && !started.After(now) && expires != nil && expires.After(now)
	limit := int64(0)
	if professional {
		limit = s.policy.MonthlyDownloadLimitBytes
	}
	remaining := limit - used
	if remaining < 0 {
		remaining = 0
	}
	result := Summary{WorkspaceID: workspaceID, Plan: PlanBase, ProfessionalStartedAt: started, ProfessionalExpiresAt: expires,
		MonthlyDownloadLimitBytes: limit, MonthlyDownloadUsedBytes: used, MonthlyDownloadRemainingBytes: remaining, TrafficPackBalanceBytes: pack, Notices: []Notice{},
		ProfessionalAnnualPriceCents: s.policy.ProfessionalAnnualPriceCents, ProfessionalDefaultMonths: s.policy.ProfessionalDefaultMonths,
		BaseHistoryDays: s.policy.BaseHistoryDays, BaseExportDays: s.policy.BaseExportDays,
		TrafficPackSizeBytes: s.policy.TrafficPackSizeBytes, TrafficPackPriceCents: s.policy.TrafficPackPriceCents}
	if professional {
		result.Plan = PlanProfessional
		result.FullHistory = true
		result.ProfessionalFeatures = true
		days := int(expires.Sub(now).Hours() / 24)
		if days < 0 {
			days = 0
		}
		result.DaysUntilExpiry = &days
		if len(s.policy.ExpiryNoticeDays) > 0 && days <= s.policy.ExpiryNoticeDays[0] {
			level := expiryNoticeLevel(days, s.policy.ExpiryNoticeDays)
			result.Notices = append(result.Notices, Notice{Code: "professional_expiring", Level: level, Message: "专业版将在近期到期"})
		}
	}
	if limit > 0 {
		result.UsagePercent = float64(used) * 100 / float64(limit)
	}
	for _, threshold := range s.policy.DownloadUsageWarningPercentages {
		if result.UsagePercent >= float64(threshold) {
			result.WarningLevel = threshold
		}
	}
	if result.WarningLevel > 0 {
		level := "warning"
		if result.WarningLevel == s.policy.DownloadUsageWarningPercentages[len(s.policy.DownloadUsageWarningPercentages)-1] {
			level = "error"
		}
		result.Notices = append(result.Notices, Notice{Code: "download_usage_warning", Level: level, Message: "本月下载额度即将用尽"})
	}
	return result
}

func expiryNoticeLevel(days int, thresholds []int) string {
	level := "info"
	for index, threshold := range thresholds {
		if days <= threshold && index > 0 {
			level = "warning"
		}
	}
	if len(thresholds) > 1 && days <= thresholds[len(thresholds)-1] {
		level = "error"
	}
	return level
}

func (s *Service) RequireProfessional(ctx context.Context, workspaceID uuid.UUID) error {
	summary, err := s.Summary(ctx, workspaceID)
	if err != nil {
		return err
	}
	if summary.Plan != PlanProfessional {
		return apperr.New(apperr.KindPermissionDenied, "professional plan required")
	}
	return nil
}

func (s *Service) ReserveDownload(ctx context.Context, in ReserveDownloadInput) error {
	if in.WorkspaceID == uuid.Nil || in.Bytes <= 0 || strings.TrimSpace(in.ObjectKey) == "" || strings.TrimSpace(in.IdempotencyKey) == "" {
		return apperr.New(apperr.KindInvalidArgument, "valid download reservation details are required")
	}
	switch in.SourceType {
	case "media", "export", "processing", "api_file":
	default:
		return apperr.New(apperr.KindInvalidArgument, "invalid download source type")
	}
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return apperr.Wrap(apperr.KindInternal, "begin download reservation", err)
	}
	defer tx.Rollback(ctx)
	var started, expires *time.Time
	var pack int64
	err = tx.QueryRow(ctx, `SELECT professional_started_at,professional_expires_at,traffic_pack_balance_bytes FROM workspace_billing_accounts WHERE workspace_id=$1 FOR UPDATE`, in.WorkspaceID).Scan(&started, &expires, &pack)
	if errors.Is(err, pgx.ErrNoRows) {
		return apperr.New(apperr.KindPermissionDenied, "professional plan required for file downloads")
	}
	if err != nil {
		return apperr.Wrap(apperr.KindInternal, "lock billing account", err)
	}
	now := time.Now().UTC()
	if started == nil || started.After(now) || expires == nil || !expires.After(now) {
		return apperr.New(apperr.KindPermissionDenied, "professional plan required for file downloads")
	}
	var exists bool
	err = tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM workspace_download_usage WHERE workspace_id=$1 AND idempotency_key=$2)`, in.WorkspaceID, in.IdempotencyKey).Scan(&exists)
	if err != nil {
		return apperr.Wrap(apperr.KindInternal, "check download reservation", err)
	}
	if exists {
		return tx.Commit(ctx)
	}
	month := monthStart(now)
	var used int64
	err = tx.QueryRow(ctx, `SELECT COALESCE(sum(monthly_bytes),0) FROM workspace_download_usage WHERE workspace_id=$1 AND usage_month=$2`, in.WorkspaceID, month).Scan(&used)
	if err != nil {
		return apperr.Wrap(apperr.KindInternal, "load monthly download usage", err)
	}
	monthlyAvailable := s.policy.MonthlyDownloadLimitBytes - used
	if monthlyAvailable < 0 {
		monthlyAvailable = 0
	}
	monthlyBytes := in.Bytes
	if monthlyBytes > monthlyAvailable {
		monthlyBytes = monthlyAvailable
	}
	packBytes := in.Bytes - monthlyBytes
	if packBytes > pack {
		return apperr.New(apperr.KindPermissionDenied, "download allowance exhausted")
	}
	_, err = tx.Exec(ctx, `INSERT INTO workspace_download_usage(workspace_id,usage_month,source_type,resource_id,object_key,bytes,monthly_bytes,traffic_pack_bytes,actor_user_id,idempotency_key) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, in.WorkspaceID, month, in.SourceType, in.ResourceID, in.ObjectKey, in.Bytes, monthlyBytes, packBytes, in.ActorUserID, in.IdempotencyKey)
	if err != nil {
		return apperr.Wrap(apperr.KindInternal, "record download usage", err)
	}
	if packBytes > 0 {
		_, err = tx.Exec(ctx, `UPDATE workspace_billing_accounts SET traffic_pack_balance_bytes=traffic_pack_balance_bytes-$2,updated_at=now() WHERE workspace_id=$1`, in.WorkspaceID, packBytes)
		if err != nil {
			return apperr.Wrap(apperr.KindInternal, "consume traffic pack", err)
		}
	}
	if err = tx.Commit(ctx); err != nil {
		return apperr.Wrap(apperr.KindInternal, "commit download reservation", err)
	}
	return nil
}

func (s *Service) GrantProfessional(ctx context.Context, workspaceID, adminID uuid.UUID, in GrantProfessionalInput) (Summary, error) {
	in.SourceType = strings.TrimSpace(in.SourceType)
	in.ReferenceNo = strings.TrimSpace(in.ReferenceNo)
	in.Reason = strings.TrimSpace(in.Reason)
	if in.SourceType != "device_order" && in.SourceType != "service_contract" && in.SourceType != "manual_correction" {
		return Summary{}, apperr.New(apperr.KindInvalidArgument, "invalid grant source type")
	}
	if in.SourceType != "manual_correction" && in.ReferenceNo == "" {
		return Summary{}, apperr.New(apperr.KindInvalidArgument, "contract or order reference is required")
	}
	if in.SourceType == "device_order" && in.DurationMonths > s.policy.ProfessionalDefaultMonths {
		return Summary{}, apperr.New(apperr.KindInvalidArgument, "a device order can grant at most one standard professional term")
	}
	if len(in.Reason) < 5 {
		return Summary{}, apperr.New(apperr.KindInvalidArgument, "grant reason must contain at least 5 characters")
	}
	if in.AmountCents < 0 {
		return Summary{}, apperr.New(apperr.KindInvalidArgument, "amount must not be negative")
	}
	tx, err := s.db.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return Summary{}, apperr.Wrap(apperr.KindInternal, "begin billing transaction", err)
	}
	defer tx.Rollback(ctx)
	now := time.Now().UTC()
	_, err = tx.Exec(ctx, `INSERT INTO workspace_billing_accounts(workspace_id) SELECT id FROM workspaces WHERE id=$1 ON CONFLICT DO NOTHING`, workspaceID)
	if err != nil {
		return Summary{}, apperr.Wrap(apperr.KindInternal, "initialize billing account", err)
	}
	var currentStart, currentExpiry *time.Time
	err = tx.QueryRow(ctx, `SELECT professional_started_at,professional_expires_at FROM workspace_billing_accounts WHERE workspace_id=$1 FOR UPDATE`, workspaceID).Scan(&currentStart, &currentExpiry)
	if err != nil {
		return Summary{}, apperr.Wrap(apperr.KindNotFound, "workspace billing account not found", err)
	}
	start := now
	if in.StartsAt != nil {
		start = in.StartsAt.UTC()
	}
	if in.SourceType != "manual_correction" && currentExpiry != nil && currentExpiry.After(start) {
		start = *currentExpiry
	}
	var end time.Time
	if in.EndsAt != nil {
		end = in.EndsAt.UTC()
		if in.SourceType != "manual_correction" && in.StartsAt == nil && currentExpiry != nil && currentExpiry.After(now) {
			duration := end.Sub(now)
			end = start.Add(duration)
		}
	} else {
		months := in.DurationMonths
		if months <= 0 {
			months = s.policy.ProfessionalDefaultMonths
		}
		end = start.AddDate(0, months, 0)
	}
	if !end.After(start) {
		return Summary{}, apperr.New(apperr.KindInvalidArgument, "grant end must be after start")
	}
	if in.SourceType == "device_order" && end.After(start.AddDate(0, s.policy.ProfessionalDefaultMonths, 0)) {
		return Summary{}, apperr.New(apperr.KindInvalidArgument, "a device order can grant at most one standard professional term")
	}
	var ref any
	if in.ReferenceNo != "" {
		ref = in.ReferenceNo
	}
	_, err = tx.Exec(ctx, `INSERT INTO workspace_plan_grants(workspace_id,source_type,reference_no,amount_cents,starts_at,ends_at,reason,actor_admin_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8)`, workspaceID, in.SourceType, ref, in.AmountCents, start, end, in.Reason, adminID)
	if err != nil {
		if strings.Contains(err.Error(), "workspace_plan_grants_reference_unique") {
			return Summary{}, apperr.New(apperr.KindConflict, "this contract or order has already granted professional access")
		}
		return Summary{}, apperr.Wrap(apperr.KindInternal, "record professional grant", err)
	}
	accountStart := start
	if in.SourceType != "manual_correction" && currentStart != nil && currentStart.Before(start) {
		accountStart = *currentStart
	}
	_, err = tx.Exec(ctx, `UPDATE workspace_billing_accounts SET professional_started_at=$2,professional_expires_at=$3,updated_at=now() WHERE workspace_id=$1`, workspaceID, accountStart, end)
	if err != nil {
		return Summary{}, apperr.Wrap(apperr.KindInternal, "update professional entitlement", err)
	}
	if err = tx.Commit(ctx); err != nil {
		return Summary{}, apperr.Wrap(apperr.KindInternal, "commit professional grant", err)
	}
	return s.Summary(ctx, workspaceID)
}

func (s *Service) AddTrafficPack(ctx context.Context, workspaceID, adminID uuid.UUID, in AddTrafficPackInput) (Summary, error) {
	in.ReferenceNo = strings.TrimSpace(in.ReferenceNo)
	in.Reason = strings.TrimSpace(in.Reason)
	if in.Bytes <= 0 {
		return Summary{}, apperr.New(apperr.KindInvalidArgument, "traffic pack bytes must be positive")
	}
	if in.PriceCents < 0 {
		return Summary{}, apperr.New(apperr.KindInvalidArgument, "price must not be negative")
	}
	if len(in.Reason) < 5 {
		return Summary{}, apperr.New(apperr.KindInvalidArgument, "reason must contain at least 5 characters")
	}
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return Summary{}, apperr.Wrap(apperr.KindInternal, "begin traffic pack transaction", err)
	}
	defer tx.Rollback(ctx)
	_, err = tx.Exec(ctx, `INSERT INTO workspace_billing_accounts(workspace_id) SELECT id FROM workspaces WHERE id=$1 ON CONFLICT DO NOTHING`, workspaceID)
	if err != nil {
		return Summary{}, apperr.Wrap(apperr.KindInternal, "initialize billing account", err)
	}
	var ref any
	if in.ReferenceNo != "" {
		ref = in.ReferenceNo
	}
	_, err = tx.Exec(ctx, `INSERT INTO workspace_traffic_pack_grants(workspace_id,bytes,price_cents,reference_no,reason,actor_admin_id) VALUES($1,$2,$3,$4,$5,$6)`, workspaceID, in.Bytes, in.PriceCents, ref, in.Reason, adminID)
	if err != nil {
		return Summary{}, apperr.Wrap(apperr.KindInternal, "record traffic pack", err)
	}
	_, err = tx.Exec(ctx, `UPDATE workspace_billing_accounts SET traffic_pack_balance_bytes=traffic_pack_balance_bytes+$2,updated_at=now() WHERE workspace_id=$1`, workspaceID, in.Bytes)
	if err != nil {
		return Summary{}, apperr.Wrap(apperr.KindInternal, "update traffic pack balance", err)
	}
	if err = tx.Commit(ctx); err != nil {
		return Summary{}, apperr.Wrap(apperr.KindInternal, "commit traffic pack", err)
	}
	return s.Summary(ctx, workspaceID)
}

func (s *Service) History(ctx context.Context, workspaceID uuid.UUID) (History, error) {
	result := History{PlanGrants: []PlanGrant{}, TrafficPackGrants: []TrafficPackGrant{}}
	rows, err := s.db.Query(ctx, `SELECT id,workspace_id,source_type,reference_no,amount_cents,starts_at,ends_at,reason,actor_admin_id,created_at FROM workspace_plan_grants WHERE workspace_id=$1 ORDER BY created_at DESC`, workspaceID)
	if err != nil {
		return result, apperr.Wrap(apperr.KindInternal, "list plan grants", err)
	}
	for rows.Next() {
		var x PlanGrant
		if err = rows.Scan(&x.ID, &x.WorkspaceID, &x.SourceType, &x.ReferenceNo, &x.AmountCents, &x.StartsAt, &x.EndsAt, &x.Reason, &x.ActorAdminID, &x.CreatedAt); err != nil {
			rows.Close()
			return result, err
		}
		result.PlanGrants = append(result.PlanGrants, x)
	}
	rows.Close()
	rows, err = s.db.Query(ctx, `SELECT id,workspace_id,bytes,price_cents,reference_no,reason,actor_admin_id,created_at FROM workspace_traffic_pack_grants WHERE workspace_id=$1 ORDER BY created_at DESC`, workspaceID)
	if err != nil {
		return result, apperr.Wrap(apperr.KindInternal, "list traffic pack grants", err)
	}
	for rows.Next() {
		var x TrafficPackGrant
		if err = rows.Scan(&x.ID, &x.WorkspaceID, &x.Bytes, &x.PriceCents, &x.ReferenceNo, &x.Reason, &x.ActorAdminID, &x.CreatedAt); err != nil {
			rows.Close()
			return result, err
		}
		result.TrafficPackGrants = append(result.TrafficPackGrants, x)
	}
	rows.Close()
	return result, nil
}

func (s *Service) AdminRiskWorkspaces(ctx context.Context, filter string) ([]RiskWorkspace, error) {
	now := time.Now().UTC()
	rows, err := s.db.Query(ctx, `SELECT w.id,w.name,a.professional_started_at,a.professional_expires_at,
		COALESCE(a.traffic_pack_balance_bytes,0),COALESCE(sum(u.monthly_bytes),0)
		FROM workspaces w LEFT JOIN workspace_billing_accounts a ON a.workspace_id=w.id
		LEFT JOIN workspace_download_usage u ON u.workspace_id=w.id AND u.usage_month=$1
		GROUP BY w.id,w.name,a.professional_started_at,a.professional_expires_at,a.traffic_pack_balance_bytes ORDER BY w.name`, monthStart(now))
	if err != nil {
		return nil, apperr.Wrap(apperr.KindInternal, "list billing workspaces", err)
	}
	defer rows.Close()
	result := []RiskWorkspace{}
	for rows.Next() {
		var id uuid.UUID
		var name string
		var started, expires *time.Time
		var pack, used int64
		if err = rows.Scan(&id, &name, &started, &expires, &pack, &used); err != nil {
			return nil, apperr.Wrap(apperr.KindInternal, "scan billing workspace", err)
		}
		summary := s.makeSummary(id, started, expires, pack, used, now)
		risks := []string{}
		if summary.ProfessionalExpiresAt != nil && !summary.ProfessionalExpiresAt.After(now) {
			risks = append(risks, "professional_expired")
		} else if summary.DaysUntilExpiry != nil && len(s.policy.ExpiryNoticeDays) > 0 && *summary.DaysUntilExpiry <= s.policy.ExpiryNoticeDays[0] {
			risks = append(risks, "professional_expiring")
		}
		if summary.WarningLevel > 0 {
			risks = append(risks, "download_usage_warning")
		}
		if len(risks) == 0 {
			continue
		}
		if filter != "" {
			matched := false
			for _, risk := range risks {
				if risk == filter {
					matched = true
				}
			}
			if !matched {
				continue
			}
		}
		result = append(result, RiskWorkspace{WorkspaceID: id, WorkspaceName: name, Summary: summary, Risks: risks})
	}
	return result, rows.Err()
}
