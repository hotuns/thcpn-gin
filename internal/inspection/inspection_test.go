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

func TestUploadDeadlineUsesBeijingSchedule(t *testing.T) {
	t.Parallel()
	day := time.Date(2026, 11, 10, 10, 17, 0, 0, beijing)
	boundary := parseSchedule("0,5,10,15 *").missedAfter(day, 3)
	if want := day.Add(-17 * time.Minute); !boundary.Equal(want) {
		t.Fatalf("boundary %v, want %v", boundary, want)
	}
	if !lateFinding(0, boundary, boundary, boundary.Add(-time.Hour), day).Active {
		t.Fatal("three missed uploads were not detected")
	}
	if lateFinding(0, boundary, boundary, boundary.Add(time.Minute), day).Active {
		t.Fatal("recently commissioned equipment should not be reported late")
	}
	night := time.Date(2026, 11, 11, 7, 0, 0, 0, beijing)
	if got := parseSchedule("0 8,16").missedAfter(night, 0); got.Day() != 10 || got.Hour() != 16 {
		t.Fatalf("overnight schedule %v", got)
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
	must(`INSERT INTO devices(id,name,device_type,lifecycle_status) VALUES ($1,'Running','standalone','online'),($2,'Retired','standalone','retired')`, id, excluded)
	must(`INSERT INTO device_source_refs(device_id,data_source_id,adapter_code,external_key) VALUES($1,$3,'thcpn_legacy_mysql','101'),($2,$3,'thcpn_legacy_mysql','102')`, id, excluded, source)
	now := time.Now()
	for i := 0; i < 2; i++ {
		if err := s.persist(ctx, id, progress{}, []finding{{Key: "late:0", Kind: "late", Metric: "data", Since: now, At: now, Active: true}}, now, time.Minute, true, ""); err != nil {
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
	// A source that cannot be opened is visible as a failed check, not as a new offline event.
	must(`UPDATE device_inspection_state SET next_check_at=now()-interval '1 minute',progress='{}' WHERE device_id=$1`, id)
	s.Sources = datasource.NewService(db)
	if n, err := s.ProcessAvailable(ctx, 20); err != nil || n != 1 {
		t.Fatalf("check unavailable source: %d %v", n, err)
	}
	request("GET", "/devices?state=error", "", http.StatusOK, `"total":1`)
	request("GET", "/events?status=all", "", http.StatusOK, `"total":1`)
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
