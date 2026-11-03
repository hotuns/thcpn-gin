package dashboard

import (
	"context"
	"errors"
	"sync/atomic"
	"testing"
	"time"

	"github.com/google/uuid"

	"thcpn-gin/internal/apperr"
	"thcpn-gin/internal/auth"
	"thcpn-gin/internal/datasource/platform"
	"thcpn-gin/internal/device"
	"thcpn-gin/internal/permission"
)

func ptr[T any](value T) *T { return &value }

func sampleEntry(now time.Time, identity string, total int64) cachedStatistics {
	return cachedStatistics{AsOf: now, AttemptedAt: now, Data: platform.ObservationStatistics{
		Identity: identity, TotalRecords: ptr(total), TotalImages: ptr(int64(3)),
		FirstObservedAt: ptr(now.AddDate(-1, 0, 0)), LastObservedAt: ptr(now.Add(-time.Minute)), ExpectedIntervalSeconds: ptr(int64(1800)),
		Days: []platform.ObservationDay{{Date: dayStart(now).Format(time.DateOnly), Records: ptr(int64(12)), Images: ptr(int64(1))}},
	}}
}

func TestAggregateCountsPhysicalSamplesAndKeepsUnknowns(t *testing.T) {
	now := time.Date(2026, 11, 3, 2, 0, 0, 0, time.UTC)
	first, alias, missing := uuid.New(), uuid.New(), uuid.New()
	devices := []authorizedDevice{
		{Device: device.Device{ID: first, Name: "station", LifecycleStatus: "online"}, records: true, images: true},
		{Device: device.Device{ID: alias, Name: "same physical source"}, records: true, images: true},
		{Device: device.Device{ID: missing, Name: "unknown source"}, records: true, images: true},
	}
	entries := map[uuid.UUID]cachedStatistics{first: sampleEntry(now, "source:station", 1000), alias: sampleEntry(now, "source:station", 1000), missing: {Failed: true, AttemptedAt: now}}
	result := aggregate(devices, entries, now, 7)
	if result.Records.Total.Value == nil || *result.Records.Total.Value != 1000 || result.Records.Total.Complete || result.Records.Total.CoveredDevices != 1 || result.Records.Total.TotalDevices != 2 {
		t.Fatalf("source aliases must not inflate partial totals: %+v", result.Records.Total)
	}
	if *result.Records.Today.Value != 12 || result.Trend[6].RecordsComplete || *result.Trend[6].Records != 12 {
		t.Fatalf("known daily values must stay partial: %+v", result.Trend[6])
	}
	if result.Devices.Reporting != 1 || result.Devices.Unknown != 1 || len(result.Attention) != 1 {
		t.Fatalf("source errors must not appear healthy: %+v", result.Devices)
	}
	unknown := aggregate(devices[2:], entries, now, 7)
	if unknown.Records.Total.Value != nil || unknown.Images.Today.Value != nil || unknown.Trend[0].Records != nil {
		t.Fatal("all-unavailable counts must remain null, never zero")
	}
	empty := aggregate(nil, nil, now, 7)
	if empty.Records.Total.Value == nil || *empty.Records.Total.Value != 0 || !empty.Records.Total.Complete {
		t.Fatal("an authorized empty workspace must have complete zero counts")
	}
}

func TestAggregateRangeMidnightAndStaleSnapshots(t *testing.T) {
	// UTC 16:01 is the next day in the fixed observation timezone.
	now := time.Date(2026, 11, 2, 16, 1, 0, 0, time.UTC)
	id := uuid.New()
	item := authorizedDevice{Device: device.Device{ID: id}, records: true, images: true}
	entry := sampleEntry(now, "source", 400)
	entry.Data.Days = []platform.ObservationDay{
		{Date: "2026-11-02", Records: ptr(int64(9)), Images: ptr(int64(2))},
		{Date: "2026-11-03", Records: ptr(int64(1)), Images: ptr(int64(0))},
	}
	entries := map[uuid.UUID]cachedStatistics{id: entry}
	seven := aggregate([]authorizedDevice{item}, entries, now, 7)
	thirty := aggregate([]authorizedDevice{item}, entries, now, 30)
	if *seven.Records.Total.Value != *thirty.Records.Total.Value || *seven.Records.Today.Value != 1 || seven.Trend[6].Date != "2026-11-03" {
		t.Fatal("trend range must not filter cumulative totals, and today must use Shanghai time")
	}
	entry.AsOf = now.Add(-2 * time.Minute)
	entry.Data.Days = entry.Data.Days[:1]
	entries[id] = entry
	stale := aggregate([]authorizedDevice{item}, entries, now, 7)
	if stale.Records.Total.Complete || stale.Records.Today.Value != nil || stale.Devices.Reporting != 0 {
		t.Fatal("a pre-midnight snapshot cannot make the new day a complete zero")
	}
}

func TestPartialSourceCountsRemainVisibleWithoutClaimingCoverage(t *testing.T) {
	now := time.Now()
	id := uuid.New()
	entry := sampleEntry(now, "known-positions", 801)
	entry.Data.RecordsPartial = true
	result := aggregate([]authorizedDevice{{Device: device.Device{ID: id}, records: true, images: true}}, map[uuid.UUID]cachedStatistics{id: entry}, now, 7)
	if result.Records.Total.Value == nil || *result.Records.Total.Value != 801 || result.Records.Total.Complete || result.Records.Total.CoveredDevices != 0 || result.Records.Total.TotalDevices != 1 || result.Records.Today.Complete || result.Trend[6].RecordsComplete {
		t.Fatalf("known subset became complete or disappeared: %+v", result.Records)
	}
	if !result.Images.Total.Complete || result.Devices.Reporting != 0 || result.Devices.Unknown != 1 {
		t.Fatal("record completeness must not alter image coverage or assert gateway health")
	}
}

func TestDailyOnlyCountsKeepTheirStatisticsTimestamp(t *testing.T) {
	now := time.Now()
	id := uuid.New()
	entry := sampleEntry(now, "source", 100)
	entry.Data.TotalImages = nil
	result := aggregate([]authorizedDevice{{Device: device.Device{ID: id}, images: true}}, map[uuid.UUID]cachedStatistics{id: entry}, now, 7)
	if result.Images.Total.Value != nil || result.Images.Today.Value == nil || result.StatisticsUpdatedAt == nil || !result.StatisticsUpdatedAt.Equal(now) {
		t.Fatal("known daily images must carry their snapshot time even when lifetime images are unknown")
	}
}

func TestDeviceHealthNeedsActualObservationAndSchedule(t *testing.T) {
	now := time.Now()
	id := uuid.New()
	devices := []authorizedDevice{{Device: device.Device{ID: id, Status: "active", LifecycleStatus: "online"}, records: true, images: true}}
	entry := sampleEntry(now, "source", 10)
	entry.Data.ExpectedIntervalSeconds = nil
	result := aggregate(devices, map[uuid.UUID]cachedStatistics{id: entry}, now, 7)
	if result.Devices.Unknown != 1 || result.Devices.Reporting != 0 {
		t.Fatal("active device metadata without a known schedule is not proof of normal updates")
	}
	entry.Data.ExpectedIntervalSeconds = ptr(int64(600))
	entry.Data.LastObservedAt = ptr(now.Add(-21 * time.Minute))
	result = aggregate(devices, map[uuid.UUID]cachedStatistics{id: entry}, now, 7)
	if result.Devices.Delayed != 1 || *result.Attention[0].ThresholdSeconds != 1200 {
		t.Fatal("known upload cadence and actual observation determine delayed status")
	}
}

type fakeRepository struct {
	items        []device.Device
	versions     map[uuid.UUID]string
	lastAlertIDs []uuid.UUID
}

func (r *fakeRepository) Devices(context.Context, auth.Actor, uuid.UUID) ([]device.Device, error) {
	return r.items, nil
}
func (r *fakeRepository) Revisions(_ context.Context, ids []uuid.UUID) (map[uuid.UUID]string, error) {
	result := make(map[uuid.UUID]string)
	for _, id := range ids {
		result[id] = r.versions[id]
	}
	return result, nil
}
func (r *fakeRepository) ActiveAlerts(_ context.Context, _ uuid.UUID, ids []uuid.UUID) (int64, error) {
	r.lastAlertIDs = ids
	return int64(len(ids)), nil
}

type fakePermissions struct {
	workspace   bool
	revoked     uuid.UUID
	mediaDenied uuid.UUID
}

func (p *fakePermissions) Can(_ context.Context, _ permission.Actor, action string, resource permission.ResourceRef) (permission.Decision, error) {
	allowed := p.workspace && resource.ID != p.revoked && !(action == "media.archive_view" && resource.ID == p.mediaDenied)
	return permission.Decision{Allowed: allowed}, nil
}

func TestOverviewRechecksPermissionsBeforeCachedTotals(t *testing.T) {
	now := time.Now()
	a, b := uuid.New(), uuid.New()
	repo := &fakeRepository{items: []device.Device{{ID: a}, {ID: b}}, versions: map[uuid.UUID]string{a: "a", b: "b"}}
	checker := &fakePermissions{workspace: true, mediaDenied: b}
	cache := newStatisticsCache(nil, nil)
	cache.items["a"], cache.items["b"] = sampleEntry(now, "a", 20), sampleEntry(now, "b", 80)
	s := &Service{store: repo, checker: checker, cache: cache, now: func() time.Time { return now }}
	actor, workspace := auth.Actor{UserID: uuid.New()}, uuid.New()
	result, err := s.Overview(context.Background(), actor, workspace, 7)
	if err != nil || *result.Records.Total.Value != 100 || *result.Images.Total.Value != 3 {
		t.Fatalf("metric permissions must filter source counts independently: result=%+v err=%v", result, err)
	}
	checker.revoked = b
	result, err = s.Overview(context.Background(), actor, workspace, 7)
	if err != nil || *result.Records.Total.Value != 20 || len(repo.lastAlertIDs) != 1 || repo.lastAlertIDs[0] != a {
		t.Fatal("revoked cached source counts and alerts must disappear on the next request")
	}
	checker.workspace = false
	_, err = s.Overview(context.Background(), actor, uuid.New(), 7)
	if apperr.KindOf(err) != apperr.KindPermissionDenied {
		t.Fatalf("unrelated workspace: %v", err)
	}
}

type blockingReader struct {
	calls   atomic.Int32
	started chan struct{}
	release chan struct{}
	fail    bool
}

func (r *blockingReader) ObservationStatistics(ctx context.Context, _ uuid.UUID, start, end time.Time) (platform.ObservationStatistics, error) {
	r.calls.Add(1)
	select {
	case r.started <- struct{}{}:
	default:
	}
	select {
	case <-r.release:
	case <-ctx.Done():
		return platform.ObservationStatistics{}, ctx.Err()
	}
	if r.fail {
		return platform.ObservationStatistics{}, errors.New("source failed")
	}
	return sampleEntry(end, "source", 42).Data, nil
}

func TestCacheDoesNotBlockOrDuplicateColdReads(t *testing.T) {
	r := &blockingReader{started: make(chan struct{}, 4), release: make(chan struct{})}
	cache := newStatisticsCache(r, nil)
	id, now := uuid.New(), time.Now()
	keys := map[uuid.UUID]string{id: "source-version-1"}
	first := cache.load(context.Background(), keys, now)
	if !first[id].AsOf.IsZero() {
		t.Fatal("cold results must be unknown")
	}
	select {
	case <-r.started:
	case <-time.After(time.Second):
		t.Fatal("background refresh not started")
	}
	for range 10 {
		cache.load(context.Background(), keys, now)
	}
	if r.calls.Load() != 1 {
		t.Fatal("concurrent readers caused duplicate scans")
	}
	close(r.release)
	deadline := time.Now().Add(time.Second)
	for time.Now().Before(deadline) {
		value := cache.load(context.Background(), keys, now)[id]
		if !value.AsOf.IsZero() {
			if *value.Data.TotalRecords != 42 {
				t.Fatal("incorrect cached count")
			}
			return
		}
		time.Sleep(time.Millisecond)
	}
	t.Fatal("completed background result was not cached")
}
