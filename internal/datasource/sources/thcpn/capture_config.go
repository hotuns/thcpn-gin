package thcpn

import "thcpn-gin/internal/datasource/platform"

func CaptureConfigSpec() platform.CaptureConfigSpec {
	return platform.CaptureConfigSpec{
		Sensors: []platform.CaptureFieldRule{
			{Key: "model", Path: "sensorType", Kind: "text"}, {Key: "description", Path: "description", Kind: "text"},
			{Key: "driver", Path: "sensor", Kind: "text"}, {Key: "port", Path: "port", Kind: "text"},
			{Key: "channel", Path: "port_num", Kind: "integer"}, {Key: "command", Path: "params.command", Kind: "text"},
			{Key: "wait_time", Path: "params.wait_time", Kind: "integer"},
		},
		Metrics: []platform.CaptureFieldRule{
			{Key: "name", Path: "info.name", Kind: "text"}, {Key: "unit", Path: "info.unit", Kind: "text"},
			{Key: "decode", Path: "decode", Kind: "text"}, {Key: "index", Path: "info.index", Kind: "integer"},
			{Key: "min", Path: "info.min", Kind: "number"}, {Key: "max", Path: "info.max", Kind: "number"},
		},
		Cameras: []platform.CaptureFieldRule{
			{Key: "name", Path: "name", Kind: "text"}, {Key: "description", Path: "desc", Kind: "text"},
			{Key: "model", Path: "sensorType", Kind: "text"}, {Key: "port", Path: "port", Kind: "text"},
			{Key: "channel", Path: "port_num", Kind: "integer"},
		},
		LegacySensors: []platform.CaptureFieldRule{{Key: "name", Path: "desc", Kind: "text"}, {Key: "unit", Path: "unit", Kind: "text"}},
		LegacyCameras: []platform.CaptureFieldRule{{Key: "name", Path: "desc", Kind: "text"}},
	}
}
