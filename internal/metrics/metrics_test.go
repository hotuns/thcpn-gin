package metrics

import (
	"errors"
	"testing"
	"time"
)

func TestMetricObserversAcceptMissingLabels(t *testing.T) {
	ObserveHTTPRequest("", "", 200, time.Millisecond)
	ObserveDataSourceQuery("", "", "", errors.New("failed"), time.Millisecond)
	ObserveTelemetryBatch("", 1, 1, 10, 5, 0)
	ObserveExportJob("", "", time.Millisecond)
}
