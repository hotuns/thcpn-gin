package processing

import (
	"context"
	"strings"
	"testing"

	"thcpn-gin/internal/apperr"
)

func TestTaskNameLimitBeforeDatabaseWrite(t *testing.T) {
	// PostgreSQL stores task names in varchar(128); reject earlier with a public error.
	_, err := (&Service{}).CreateTask(context.Background(), CreateInput{Name: strings.Repeat("中", 129)})
	details := apperr.DetailsOf(err)
	if apperr.KindOf(err) != apperr.KindInvalidArgument || details["field"] != "processing_name" || details["maximum"] != int64(128) || details["actual"] != int64(129) {
		t.Fatalf("wrong name limit: %v %v", err, details)
	}
}
