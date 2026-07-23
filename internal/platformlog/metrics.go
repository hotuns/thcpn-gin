package platformlog

import "github.com/prometheus/client_golang/prometheus"

var (
	writeFailures  = prometheus.NewCounterVec(prometheus.CounterOpts{Name: "thcpn_platform_log_write_failures_total", Help: "Platform runtime log write failures."}, []string{"service", "stage"})
	directoryBytes = prometheus.NewGaugeVec(prometheus.GaugeOpts{Name: "thcpn_platform_log_directory_bytes", Help: "Bytes used by platform runtime log files and indexes."}, []string{"service"})
	indexRebuilds  = prometheus.NewCounterVec(prometheus.CounterOpts{Name: "thcpn_platform_log_index_rebuilds_total", Help: "Platform runtime log index rebuild outcomes."}, []string{"service", "result"})
)

func init() { prometheus.MustRegister(writeFailures, directoryBytes, indexRebuilds) }
