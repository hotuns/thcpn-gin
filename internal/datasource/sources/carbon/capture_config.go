package carbon

import "thcpn-gin/internal/datasource/platform"

func CaptureConfigSpec() platform.CaptureConfigSpec {
	return platform.CaptureConfigSpec{
		Sensors: []platform.CaptureFieldRule{
			{Key: "description", Path: "description", Kind: "text"},
			{Key: "port", Path: "hardware_interface_type", Kind: "text"}, {Key: "channel", Path: "hardware_interface_channel", Kind: "integer"},
			{Key: "driver", Path: "software_interface_type", Kind: "text"},
			{Key: "command", Path: "params.command", Kind: "text"}, {Key: "wait_time", Path: "params.wait_time", Kind: "integer"},
		},
		Metrics: []platform.CaptureFieldRule{
			{Key: "name", Path: "info.name", Kind: "text"}, {Key: "unit", Path: "info.unit", Kind: "text"},
			{Key: "decode", Path: "decode", Kind: "text"}, {Key: "index", Path: "info.index", Kind: "integer"},
			{Key: "min", Path: "info.min", Kind: "number"}, {Key: "max", Path: "info.max", Kind: "number"},
		},
	}
}
