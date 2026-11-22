package inspection

import (
	"bytes"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"thcpn-gin/internal/auth"
	"thcpn-gin/internal/datasource"
	"thcpn-gin/internal/telemetry"
	"thcpn-gin/internal/testdb"
)

func TestNoUploadSeverityUsesElapsedTime(t *testing.T) {
	t.Parallel()
	now := time.Date(2026, 11, 10, 10, 17, 0, 0, beijing)
	oldStart := now.Add(-10 * 24 * time.Hour)
	for _, tt := range []struct {
		name         string
		last, start  time.Time
		wantSeverity string
	}{
		{name: "just short of 1 day", last: now.Add(-24*time.Hour + time.Nanosecond), start: oldStart},
		{name: "exactly 1 day", last: now.Add(-24 * time.Hour), start: oldStart, wantSeverity: "warning"},
		{name: "just short of 3 days", last: now.Add(-72*time.Hour + time.Nanosecond), start: oldStart, wantSeverity: "warning"},
		{name: "exactly 3 days", last: now.Add(-72 * time.Hour), start: oldStart, wantSeverity: "critical"},
		{name: "never reported after commissioning yesterday", start: now.Add(-24 * time.Hour), wantSeverity: "warning"},
		{name: "never reported for over 3 days", start: oldStart, wantSeverity: "critical"},
		{name: "test samples predate commissioning", last: now.Add(-7 * 24 * time.Hour), start: now.Add(-2 * time.Hour)},
		{name: "commissioning starts later", last: now.Add(-7 * 24 * time.Hour), start: now.Add(time.Hour)},
	} {
		t.Run(tt.name, func(t *testing.T) {
			got := lateFinding(2, tt.last, tt.start, now)
			if got.Active != (tt.wantSeverity != "") || got.Severity != tt.wantSeverity {
				t.Fatalf("active %t, severity %q, want %q", got.Active, got.Severity, tt.wantSeverity)
			}
			if got.Kind != "late" || got.Key != "late:2" || got.Node == nil || *got.Node != 2 {
				t.Fatalf("lost the node or existing event identity: %#v", got)
			}
			if got.Active && (!got.Since.Equal(maxTime(tt.last, tt.start).Add(24*time.Hour)) || !got.At.Equal(now)) {
				t.Fatalf("wrong event timestamps: started %v, checked %v", got.Since, got.At)
			}
		})
	}
}

func TestMissingAndZeroUseNewSamples(t *testing.T) {
	t.Parallel()
	now := time.Date(2026, 11, 10, 4, 0, 0, 0, time.UTC)
	a, b := uuid.New(), uuid.New()
	makePoint := func(i int, v float64) telemetry.Point {
		return telemetry.Point{Timestamp: now.Add(time.Duration(i) * time.Minute), Value: v}
	}
	streams := []telemetry.Series{
		{DataStreamID: a, Name: "土壤水分", Code: "soil", Complete: true, Points: []telemetry.Point{makePoint(0, 20), makePoint(1, 0)}},
		{DataStreamID: b, Name: "土壤温度", Code: "temperature", Complete: true, Points: []telemetry.Point{makePoint(0, 10), makePoint(1, 10), makePoint(2, 10), makePoint(3, 10), makePoint(4, 10)}},
	}
	p := progress{Latest: make(map[int]time.Time), Counters: make(map[string]counter)}
	tpl := Template{ID: uuid.New(), Family: "thcpn", Code: "soil", Kind: "zero", Enabled: true, Consecutive: 3}
	f, _ := inspectStreams(&p, "thcpn", streams, []Template{tpl})
	active := map[string]bool{}
	for _, item := range f {
		if item.Active {
			active[item.Kind] = true
		}
	}
	if !active["missing"] || active["zero"] {
		t.Fatalf("unexpected findings %#v", f)
	}
	if f, _ = inspectStreams(&p, "thcpn", streams, []Template{tpl}); len(f) != 0 {
		t.Fatalf("replayed results counted again: %#v", f)
	}
	streams[0].Points = append(streams[0].Points, makePoint(5, 0), makePoint(6, 0))
	f, _ = inspectStreams(&p, "thcpn", streams, []Template{tpl})
	active = map[string]bool{}
	for _, item := range f {
		active[item.Kind] = item.Active
	}
	if active["missing"] || !active["zero"] {
		t.Fatalf("zero and missing conflated %#v", f)
	}
	streams[1].Error = "source unavailable"
	if f, ok := inspectStreams(&p, "thcpn", streams, nil); ok || len(f) > 0 {
		t.Fatal("failed source must not turn into missing readings")
	}
}

func TestInspectionMigrationAndAdminViews(t *testing.T) {
	db := testdb.Open(t, 58)
	const severityUp = "../../migrations/000061_inspection_event_severity.up.sql"
	const severityDown = "../../migrations/000061_inspection_event_severity.down.sql"
	ctx := t.Context()
	actor := testdb.Admin(t, db)
	s := &Service{DB: db}
	must := func(sql string, args ...any) {
		t.Helper()
		if _, err := db.Exec(ctx, sql, args...); err != nil {
			t.Fatal(err)
		}
	}
	id, excluded, source := uuid.New(), uuid.New(), uuid.New()
	must(`INSERT INTO data_sources(id,name,type,source_family,dsn_secret_ref,created_by) VALUES ($1,'test','mysql','thcpn','env:NOT_USED',$2)`, source, actor)
	must(`INSERT INTO devices(id,name,device_type,lifecycle_status,created_at)
 VALUES ($1,'Running','standalone','online',now()-interval '7 days'),($2,'Retired','standalone','retired',now()-interval '7 days')`, id, excluded)
	must(`INSERT INTO device_source_refs(device_id,data_source_id,adapter_code,external_key) VALUES($1,$3,'thcpn_legacy_mysql','101'),($2,$3,'thcpn_legacy_mysql','102')`, id, excluded, source)
	now := time.Now().UTC()
	start, sample := now.Add(-7*24*time.Hour), now.Add(-24*time.Hour)
	must(`INSERT INTO device_inspection_events(device_id,event_key,kind,metric,detail,started_at,last_seen_at)
 VALUES ($1,'late:0','late','采集数据','旧规则',$2,$2)`, id, now)
	testdb.Apply(t, db, severityUp)
	for i := 0; i < 2; i++ {
		if err := s.persist(ctx, id, progress{}, []finding{lateFinding(0, sample, start, now)}, now, time.Minute, false, ""); err != nil {
			t.Fatal(err)
		}
	}
	router := gin.New()
	router.Use(func(c *gin.Context) {
		auth.SetActorContext(c, auth.Actor{UserID: actor, IsSystemAdmin: true})
		c.Next()
	})
	router.GET("/overview", s.Overview)
	router.GET("/devices", s.Devices)
	router.GET("/events", s.Events)
	router.GET("/metrics", s.Metrics)
	router.PUT("/templates", s.SaveTemplate)
	router.GET("/templates", s.ListTemplates)
	router.POST("/events/:id/acknowledge", s.Acknowledge)
	request := func(method, path, body string, status int, expected string) {
		t.Helper()
		w := httptest.NewRecorder()
		r := httptest.NewRequest(method, path, bytes.NewBufferString(body))
		r.Header.Set("Content-Type", "application/json")
		router.ServeHTTP(w, r)
		if w.Code != status || !bytes.Contains(w.Body.Bytes(), []byte(expected)) {
			t.Fatalf("%s %s => %d %s", method, path, w.Code, w.Body)
		}
	}
	request("GET", "/overview", "", http.StatusOK, `"eligible":1`)
	request("GET", "/devices?state=all", "", http.StatusOK, `"total":1`)
	request("GET", "/events", "", http.StatusOK, `"total":1`)
	request("GET", "/events", "", http.StatusOK, `"severity":"warning"`)
	request("GET", "/metrics", "", http.StatusOK, `"metric_code":"device_battery"`)
	request("PUT", "/templates", `{"family":"thcpn","device_type":"standalone","metric_code":"device_battery","unit":"V","kind":"range","lower_value":11.3,"consecutive":3,"enabled":true}`, http.StatusOK, `"lower_value":11.3`)
	request("GET", "/templates", "", http.StatusOK, `"device_type":"standalone"`)
	var eventID uuid.UUID
	if err := db.QueryRow(ctx, "SELECT id FROM device_inspection_events").Scan(&eventID); err != nil {
		t.Fatal(err)
	}
	request("POST", "/events/"+eventID.String()+"/acknowledge", `{"note":"检查供电"}`, http.StatusNoContent, "")
	request("GET", "/events", "", http.StatusOK, `"total":0`)
	request("GET", "/events?status=active", "", http.StatusOK, `"note":"检查供电"`)
	criticalAt := sample.Add(72 * time.Hour)
	if err := s.persist(ctx, id, progress{}, []finding{lateFinding(0, sample, start, criticalAt)}, criticalAt, time.Minute, false, ""); err != nil {
		t.Fatal(err)
	}
	request("GET", "/events", "", http.StatusOK, `"severity":"critical"`)
	request("GET", "/events", "", http.StatusOK, `"id":"`+eventID.String()+`"`)
	request("POST", "/events/"+eventID.String()+"/acknowledge", `{"note":"处理停报报警"}`, http.StatusNoContent, "")
	repeatAt := criticalAt.Add(time.Minute)
	if err := s.persist(ctx, id, progress{}, []finding{lateFinding(0, sample, start, repeatAt)}, repeatAt, time.Minute, false, ""); err != nil {
		t.Fatal(err)
	}
	request("GET", "/events", "", http.StatusOK, `"total":0`)
	// A source that cannot be opened is visible as a failed check, not as a new offline event.
	must(`UPDATE device_inspection_state SET next_check_at=now()-interval '1 minute',progress='{}' WHERE device_id=$1`, id)
	s.Sources = datasource.NewService(db)
	if n, err := s.ProcessAvailable(ctx, 20); err != nil || n != 1 {
		t.Fatalf("check unavailable source: %d %v", n, err)
	}
	request("GET", "/devices?state=error", "", http.StatusOK, `"total":1`)
	request("GET", "/events?status=active", "", http.StatusOK, `"severity":"critical"`)
	request("GET", "/events?status=all", "", http.StatusOK, `"total":1`)
	recoveredAt := repeatAt.Add(time.Minute)
	if err := s.persist(ctx, id, progress{}, []finding{lateFinding(0, recoveredAt, start, recoveredAt)}, recoveredAt, time.Minute, false, ""); err != nil {
		t.Fatal(err)
	}
	request("GET", "/events?status=active", "", http.StatusOK, `"total":0`)
	request("GET", "/events?status=resolved", "", http.StatusOK, `"severity":"critical"`)
	testdb.Apply(t, db, severityDown)
	testdb.Apply(t, db, severityUp)
	request("GET", "/events?status=resolved", "", http.StatusOK, `"severity":"warning"`)
	testdb.Apply(t, db, severityDown)
	testdb.Apply(t, db, "../../migrations/000058_device_inspection.down.sql")
	testdb.Apply(t, db, "../../migrations/000058_device_inspection.up.sql")
}

func TestBufferedReadKeepsIncidentThatAlreadyRecovered(t *testing.T) {
	now := time.Now().UTC()
	limit := 1.0
	tpl := Template{ID: uuid.New(), Family: "thcpn", Code: "soil", Kind: "range", Lower: &limit, Consecutive: 2, Enabled: true}
	p := progress{Counters: make(map[string]counter)}
	observations := map[time.Time]float64{now: 20, now.Add(time.Minute): 0, now.Add(2 * time.Minute): 0, now.Add(3 * time.Minute): 22}
	findings := checkTemplates(&p, []Template{tpl}, "thcpn", "soil", "", "soil", "metric", observations)
	if len(findings) != 3 || !findings[1].Active || findings[2].Active || !findings[1].Since.Equal(now.Add(time.Minute)) || !findings[2].At.Equal(now.Add(3*time.Minute)) {
		t.Fatalf("wanted both trigger and recovery from the same upload, got %#v", findings)
	}
}
