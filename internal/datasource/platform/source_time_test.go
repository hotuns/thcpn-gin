package platform

import (
	"testing"
	"time"
)

func TestLegacyMySQLTimezoneIndependentOfHost(t *testing.T) {
	for _, host := range []*time.Location{time.UTC, time.FixedZone("host-east", 8*3600), time.FixedZone("host-west", -7*3600)} {
		t.Run(host.String(), func(t *testing.T) {
			old := time.Local
			time.Local = host
			defer func() { time.Local = old }()
			for _, family := range []string{SourceFamilyTHCPN, SourceFamilyCarbon} {
				for _, suffix := range []string{"", "?loc=Local"} {
					cfg, err := sourceMySQLConfig("tcp(localhost:3306)/fixture"+suffix, DataSource{SourceFamily: &family})
					if err != nil {
						t.Fatal(err)
					}
					// Mirrors MySQL DATETIME decoding and parameter encoding in cfg.Loc.
					row := time.Date(2026, 10, 19, 16, 16, 37, 0, cfg.Loc)
					if row.Unix() != 1792397797 {
						t.Errorf("%s %s decoded image/telemetry/log time: %s, want epoch 1792397797", family, suffix, row)
					}
					query := time.Unix(1792397797, 0).In(cfg.Loc).Format("2006-01-02 15:04:05")
					if query != "2026-10-19 16:16:37" {
						t.Errorf("query range encoded as %s", query)
					}
				}
			}
		})
	}
}

func TestMySQLExplicitTimezoneAndGenericSourceUnchanged(t *testing.T) {
	family := SourceFamilyTHCPN
	for _, source := range []DataSource{{}, {SourceFamily: &family}} {
		cfg, err := sourceMySQLConfig("tcp(localhost:3306)/fixture?loc=UTC", source)
		if err != nil || cfg.Loc != time.UTC {
			t.Fatalf("explicit UTC changed: %v %v", cfg, err)
		}
	}
	cfg, err := sourceMySQLConfig("tcp(localhost:3306)/fixture?loc=Local", DataSource{})
	if err != nil || cfg.Loc != time.Local {
		t.Fatal("generic source behavior changed")
	}
}
