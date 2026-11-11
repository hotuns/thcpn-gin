package export

import (
	"archive/zip"
	"bytes"
	"context"
	"encoding/csv"
	"errors"
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	"thcpn-gin/internal/apperr"
	"thcpn-gin/internal/config"
	"thcpn-gin/internal/datasource/sources/carbon"
	"thcpn-gin/internal/systemsettings"
	"thcpn-gin/internal/testdb"
)

type carbonRawFixture struct {
	list func(context.Context, time.Time, time.Time) ([]carbon.CarbonPeriodSummary, error)
	read func(context.Context, string, carbon.CarbonPeriodSummary) ([]carbon.CarbonRawPhase, error)
}

func (s carbonRawFixture) CarbonRawPeriods(ctx context.Context, _ uuid.UUID, _ int, start, end time.Time) ([]carbon.CarbonPeriodSummary, error) {
	return s.list(ctx, start, end)
}
func (s carbonRawFixture) CarbonRawPeriodSamples(ctx context.Context, _ uuid.UUID, _ int, field string, period carbon.CarbonPeriodSummary) ([]carbon.CarbonRawPhase, error) {
	return s.read(ctx, field, period)
}

func TestCarbonRawExportWindowsAndSharedPeriodDiscovery(t *testing.T) {
	start := time.Date(2024, 9, 1, 0, 0, 0, 0, exportLocation)
	boundary := start.Add(7 * 24 * time.Hour)
	end := start.Add(14 * 24 * time.Hour)
	lookups, reads := 0, map[string]int{}
	source := carbonRawFixture{
		list: func(ctx context.Context, from, to time.Time) ([]carbon.CarbonPeriodSummary, error) {
			lookups++
			if to.Sub(from) > 7*24*time.Hour {
				t.Fatalf("unbounded discovery: %s - %s", from, to)
			}
			// Same cycle appears at the inclusive boundary in both windows.
			return []carbon.CarbonPeriodSummary{{Period: "shared", PeriodAt: boundary, Fields: []string{"A", "B"}}}, nil
		},
		read: func(ctx context.Context, field string, period carbon.CarbonPeriodSummary) ([]carbon.CarbonRawPhase, error) {
			reads[field]++
			v := 0.0
			return []carbon.CarbonRawPhase{{Room: "light", Points: []carbon.CarbonSensorSample{{TS: period.PeriodAt, CO2: &v}}}}, nil
		},
	}
	periods, err := carbonExportPeriods(t.Context(), source, uuid.Nil, 1, start, end)
	if err != nil || lookups != 2 || len(periods) != 1 {
		t.Fatalf("discovery=%d periods=%v error=%v", lookups, periods, err)
	}
	for _, field := range []string{"A", "B", "C", "D"} {
		var out bytes.Buffer
		count, err := writeCarbonRawCSV(t.Context(), &out, source, uuid.Nil, "CS-1", 1, field, periods, exportCSVColumn{"node_name", "含,逗号\n的名称"})
		if err != nil {
			t.Fatal(err)
		}
		rows, err := csv.NewReader(&out).ReadAll()
		if err != nil || len(rows) != count+1 {
			t.Fatalf("invalid wide CSV: %v %v", rows, err)
		}
		if count > 0 && rows[1][len(rows[1])-1] != "含,逗号\n的名称" {
			t.Fatal("node label escaped incorrectly")
		}
	}
	if lookups != 2 || reads["A"] != 1 || reads["B"] != 1 || reads["C"] != 0 || reads["D"] != 0 {
		t.Fatalf("periods re-read or absent fields fetched: lookups=%d reads=%v", lookups, reads)
	}
	cancelled, cancel := context.WithCancel(t.Context())
	cancel()
	if _, err := carbonExportPeriods(cancelled, source, uuid.Nil, 1, start, end); !errors.Is(err, context.Canceled) {
		t.Fatal(err)
	}
	if lookups != 2 {
		t.Fatal("queried after cancellation")
	}
}

func TestCarbonRawExportFailsExplicitlyAtLimitAndOnSourceError(t *testing.T) {
	period := carbon.CarbonPeriodSummary{Period: "p", Fields: []string{"A"}}
	cause := apperr.Wrap(apperr.KindDataSource, "碳汇原始数据查询超时", context.DeadlineExceeded)
	for _, fail := range []bool{false, true} {
		source := carbonRawFixture{read: func(context.Context, string, carbon.CarbonPeriodSummary) ([]carbon.CarbonRawPhase, error) {
			if fail {
				return nil, cause
			}
			return []carbon.CarbonRawPhase{{Points: make([]carbon.CarbonSensorSample, 3)}}, nil
		}}
		var out bytes.Buffer
		count, err := writeCarbonRawCSV(systemsettings.With(t.Context(), systemsettings.Values{"export_points": 2}), &out, source, uuid.Nil, "CS-1", 1, "A", []carbon.CarbonPeriodSummary{period})
		if fail {
			if !errors.Is(err, cause) || count != 0 || apperr.MessageOf(err) != "碳汇原始数据查询超时" {
				t.Fatalf("lost source failure: %d %v", count, err)
			}
		} else if err == nil || count != 2 || !strings.Contains(apperr.MessageOf(err), "最多导出 2 条") {
			t.Fatalf("silently returned an incomplete export: %d %v", count, err)
		}
	}
}

func TestCarbonRawArchiveHistoricalYearIsComplete(t *testing.T) {
	mysqlDB, dsn := testdb.MySQL(t, "carbon_sink_v2")
	ctx := t.Context()
	start := time.Date(2024, 9, 1, 0, 0, 0, 0, exportLocation)
	end := start.AddDate(1, 0, 0)
	periodTimes := []time.Time{start, start.AddDate(0, 0, 7), end}
	for _, table := range []string{"device_data_next_202409", "device_data_next_202509"} {
		_, err := mysqlDB.ExecContext(ctx, "CREATE TABLE "+table+` (
			id BIGINT PRIMARY KEY AUTO_INCREMENT, device_id BIGINT, node_id INT,
			period VARCHAR(128), period_at DATETIME, field VARCHAR(32), room VARCHAR(32),
			ts DATETIME, type VARCHAR(32), data JSON, deleted_at DATETIME,
			INDEX lookup(device_id,node_id,period_at))`)
		if err != nil {
			t.Fatal(err)
		}
	}
	for _, at := range periodTimes {
		table := "device_data_next_" + at.Format("200601")
		period := fmt.Sprintf("42_1_%d", at.Unix())
		for _, field := range []string{"A", "B", "C", "D"} {
			for _, room := range []string{"light", "black"} {
				for sample := 0; sample < 2; sample++ {
					_, err := mysqlDB.ExecContext(ctx, "INSERT INTO "+table+" (device_id,node_id,period,period_at,field,room,ts,type,data) VALUES(42,1,?,?,?,?,?,'data',?)",
						period, at.Format("2006-01-02 15:04:05"), field, room, at.Add(time.Duration(sample)*time.Second).Format("2006-01-02 15:04:05"), `[{"key":"CO2","data":0},{"key":"tempL","data":12.5}]`)
					if err != nil {
						t.Fatal(err)
					}
				}
			}
		}
	}
	pg := testdb.Open(t, 0)
	admin, source, id := testdb.Admin(t, pg), uuid.New(), uuid.New()
	t.Setenv("CARBON_EXPORT_TEST_DSN", dsn)
	must := func(query string, args ...any) {
		t.Helper()
		if _, err := pg.Exec(ctx, query, args...); err != nil {
			t.Fatal(err)
		}
	}
	must(`INSERT INTO devices(id,name,device_type,asset_no) VALUES($1,'历史碳汇站','carbon_sink','CS-72000001')`, id)
	must(`INSERT INTO data_sources(id,name,type,source_family,dsn_secret_ref,created_by) VALUES($1,'Carbon export','mysql','carbon','env:CARBON_EXPORT_TEST_DSN',$2)`, source, admin)
	must(`INSERT INTO device_source_refs(device_id,data_source_id,adapter_code,external_key) VALUES($1,$2,'carbon_sink_mysql','42')`, id, source)
	p := NewProcessor(pg, nil, nil, nil, config.ExportConfig{MaxRows: 1}, nil)
	var output bytes.Buffer
	err := p.renderCarbonStationZIP(ctx, Job{ResourceID: id}, carbonStationExportConfig{
		StartTime: start, EndTime: end, NodeIDs: []int{1}, Fields: []string{"A", "B", "C", "D"}, IncludeRawSamples: true,
	}, &output)
	if err != nil {
		t.Fatal(err)
	}
	archive, err := zip.NewReader(bytes.NewReader(output.Bytes()), int64(output.Len()))
	if err != nil {
		t.Fatal(err)
	}
	for _, field := range []string{"A", "B", "C", "D"} {
		body := readZipFile(t, archive, "CS-72000001/node-1/"+field+"/raw-samples.csv")
		rows, err := csv.NewReader(strings.NewReader(body)).ReadAll()
		if err != nil {
			t.Fatal(err)
		}
		if len(rows) != 13 {
			t.Fatalf("field %s: expected all 12 samples across historical year, got %d: %s", field, len(rows)-1, body)
		}
		for _, row := range rows[1:] {
			if row[0] != "CS-72000001" || row[4] != field || row[7] != "0" {
				t.Fatalf("identity, field or zero value lost: %v", row)
			}
		}
	}
}
