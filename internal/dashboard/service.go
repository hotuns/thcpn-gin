package dashboard

import (
	"context"
	"sort"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"

	"thcpn-gin/internal/apperr"
	"thcpn-gin/internal/auth"
	"thcpn-gin/internal/device"
	"thcpn-gin/internal/permission"
)

type permissionChecker interface {
	Can(context.Context, permission.Actor, string, permission.ResourceRef) (permission.Decision, error)
}

type Service struct {
	store   repository
	checker permissionChecker
	cache   *statisticsCache
	now     func() time.Time
}

func NewService(db *pgxpool.Pool, devices *device.Service, checker *permission.Checker, reader statisticsReader, client *redis.Client) *Service {
	return &Service{store: postgresRepository{db: db, devices: devices}, checker: checker, cache: newStatisticsCache(reader, client), now: time.Now}
}

type authorizedDevice struct {
	device.Device
	records bool
	images  bool
}

func (s *Service) Overview(ctx context.Context, actor auth.Actor, workspaceID uuid.UUID, days int) (Overview, error) {
	if actor.UserID == uuid.Nil {
		return Overview{}, apperr.New(apperr.KindUnauthorized, "missing authenticated user")
	}
	if workspaceID == uuid.Nil || (days != 7 && days != 30) {
		return Overview{}, apperr.New(apperr.KindInvalidArgument, "workspace_id and days (7 or 30) are required")
	}
	allowed, err := s.can(ctx, actor, "workspace.view", "workspace", workspaceID)
	if err != nil {
		return Overview{}, err
	}
	if !allowed {
		return Overview{}, apperr.New(apperr.KindPermissionDenied, "permission denied")
	}
	items, err := s.store.Devices(ctx, actor, workspaceID)
	if err != nil {
		return Overview{}, apperr.Wrap(apperr.KindInternal, "list dashboard devices", err)
	}
	devices := make([]authorizedDevice, 0, len(items))
	ids, alertIDs := make([]uuid.UUID, 0, len(items)), make([]uuid.UUID, 0, len(items))
	for _, item := range items {
		visible, err := s.can(ctx, actor, "device.view", "device", item.ID)
		if err != nil {
			return Overview{}, err
		}
		if !visible {
			continue
		}
		records, err := s.can(ctx, actor, "telemetry.view_history", "device", item.ID)
		if err != nil {
			return Overview{}, err
		}
		images, err := s.can(ctx, actor, "media.archive_view", "device", item.ID)
		if err != nil {
			return Overview{}, err
		}
		if !records && !images {
			continue
		}
		devices = append(devices, authorizedDevice{Device: item, records: records, images: images})
		ids = append(ids, item.ID)
		if records {
			alertIDs = append(alertIDs, item.ID)
		}
	}
	keys, err := s.store.Revisions(ctx, ids)
	if err != nil {
		return Overview{}, apperr.Wrap(apperr.KindInternal, "read dashboard source versions", err)
	}
	now := s.now()
	entries := s.cache.load(ctx, keys, now)
	result := aggregate(devices, entries, now, days)
	if count, err := s.store.ActiveAlerts(ctx, workspaceID, alertIDs); err == nil {
		result.ActiveAlerts = &count
	}
	return result, nil
}

func (s *Service) can(ctx context.Context, actor auth.Actor, action, kind string, id uuid.UUID) (bool, error) {
	decision, err := s.checker.Can(ctx, permission.Actor{UserID: actor.UserID}, action, permission.ResourceRef{Type: kind, ID: id})
	return decision.Allowed, err
}

type countAccumulator struct {
	sum     int64
	known   int
	covered int
	total   int
}

func (a *countAccumulator) add(value *int64, fresh bool) {
	a.total++
	if value != nil && *value >= 0 {
		a.sum += *value
		a.known++
		if fresh {
			a.covered++
		}
	}
}

func (a countAccumulator) count() Count {
	count := Count{Complete: a.covered == a.total, CoveredDevices: a.covered, TotalDevices: a.total}
	if a.known > 0 || a.total == 0 {
		value := a.sum
		count.Value = &value
	}
	return count
}

func aggregate(devices []authorizedDevice, entries map[uuid.UUID]cachedStatistics, now time.Time, days int) Overview {
	result := Overview{GeneratedAt: now, Timezone: "Asia/Shanghai", Days: days, RefreshIntervalSeconds: 30, Trend: make([]Day, days), Attention: []Attention{}}
	start := dayStart(now).AddDate(0, 0, 1-days)
	for i := range result.Trend {
		result.Trend[i].Date = start.AddDate(0, 0, i).Format(time.DateOnly)
	}
	var records, images, todayRecords, todayImages countAccumulator
	dailyRecords, dailyImages := make([]countAccumulator, days), make([]countAccumulator, days)
	// Repeated bindings/aliases of one physical source count once. Merge access
	// rights before summing so iteration order cannot omit an allowed metric.
	unique := make(map[string]int)
	scoped := make([]authorizedDevice, 0, len(devices))
	for _, item := range devices {
		entry := entries[item.ID]
		if entry.Data.Excluded && !entry.AsOf.IsZero() {
			continue
		}
		identity := entry.Data.Identity
		if identity == "" {
			identity = item.ID.String()
		}
		if index, ok := unique[identity]; ok {
			scoped[index].records = scoped[index].records || item.records
			scoped[index].images = scoped[index].images || item.images
			continue
		}
		unique[identity] = len(scoped)
		scoped = append(scoped, item)
	}
	for _, item := range scoped {
		entry := entries[item.ID]
		fresh := entry.fresh(now)
		data := entry.Data
		if entry.AsOf.IsZero() && !entry.Failed {
			result.RefreshIntervalSeconds = 5
		}
		contributes := (item.records && data.TotalRecords != nil) || (item.images && data.TotalImages != nil)
		for _, day := range data.Days {
			if day.Date >= result.Trend[0].Date && day.Date <= result.Trend[days-1].Date {
				contributes = contributes || (item.records && day.Records != nil) || (item.images && day.Images != nil)
			}
		}
		if !entry.AsOf.IsZero() && contributes {
			if result.StatisticsUpdatedAt == nil || entry.AsOf.Before(*result.StatisticsUpdatedAt) {
				at := entry.AsOf
				result.StatisticsUpdatedAt = &at
			}
		}
		byDate := make(map[string]int, len(data.Days))
		for i, day := range data.Days {
			byDate[day.Date] = i
		}
		if item.records {
			records.add(data.TotalRecords, fresh && !data.RecordsPartial)
			if data.FirstObservedAt != nil && (result.Records.FirstObservedAt == nil || data.FirstObservedAt.Before(*result.Records.FirstObservedAt)) {
				result.Records.FirstObservedAt = data.FirstObservedAt
			}
		}
		if item.images {
			images.add(data.TotalImages, fresh)
		}
		for i, day := range result.Trend {
			var recordCount, imageCount *int64
			if index, ok := byDate[day.Date]; ok {
				recordCount, imageCount = data.Days[index].Records, data.Days[index].Images
			}
			if item.records {
				dailyRecords[i].add(recordCount, fresh && !data.RecordsPartial)
				if i == days-1 {
					todayRecords.add(recordCount, fresh && !data.RecordsPartial)
				}
			}
			if item.images {
				dailyImages[i].add(imageCount, fresh)
				if i == days-1 {
					todayImages.add(imageCount, fresh)
				}
			}
		}
		result.Devices.Total++
		if item.LifecycleStatus == "inbound" || item.LifecycleStatus == "retired" {
			result.Devices.Inactive++
			continue
		}
		// A combined source latest timestamp is only visible to viewers with
		// access to both record and media history; otherwise keep it unknown.
		var latest *time.Time
		if item.records && item.images {
			latest = data.LastObservedAt
		}
		attention := Attention{DeviceID: item.ID, Name: item.Name, LastObservedAt: latest}
		switch {
		case !fresh || data.RecordsPartial:
			result.Devices.Unknown++
			attention.Kind = "unavailable"
		case latest == nil && data.TotalRecords != nil && *data.TotalRecords == 0 && data.TotalImages != nil && *data.TotalImages == 0:
			result.Devices.NoData++
			attention.Kind = "no_data"
		case latest == nil || latest.After(now) || data.ExpectedIntervalSeconds == nil || *data.ExpectedIntervalSeconds <= 0:
			result.Devices.Unknown++
			attention.Kind = "unavailable"
		default:
			threshold := max(*data.ExpectedIntervalSeconds*2, 300)
			attention.ThresholdSeconds = &threshold
			if now.Sub(*latest).Seconds() > float64(threshold) {
				result.Devices.Delayed++
				attention.Kind = "delayed"
			} else {
				result.Devices.Reporting++
			}
		}
		if attention.Kind != "" {
			attention.ID = attention.Kind + ":" + item.ID.String()
			result.Attention = append(result.Attention, attention)
		}
	}
	result.Records.Total, result.Records.Today = records.count(), todayRecords.count()
	result.Images.Total, result.Images.Today = images.count(), todayImages.count()
	for i := range result.Trend {
		r, p := dailyRecords[i].count(), dailyImages[i].count()
		result.Trend[i].Records, result.Trend[i].RecordsComplete = r.Value, r.Complete
		result.Trend[i].Images, result.Trend[i].ImagesComplete = p.Value, p.Complete
	}
	sort.Slice(result.Attention, func(i, j int) bool {
		a, b := result.Attention[i], result.Attention[j]
		priority := map[string]int{"delayed": 0, "no_data": 1, "unavailable": 2}
		if priority[a.Kind] != priority[b.Kind] {
			return priority[a.Kind] < priority[b.Kind]
		}
		if a.LastObservedAt != nil && b.LastObservedAt != nil && !a.LastObservedAt.Equal(*b.LastObservedAt) {
			return a.LastObservedAt.Before(*b.LastObservedAt)
		}
		return a.DeviceID.String() < b.DeviceID.String()
	})
	return result
}
