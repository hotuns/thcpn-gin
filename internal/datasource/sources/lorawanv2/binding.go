package lorawanv2

import "thcpn-gin/internal/datasource/platform"

func BindingDefinition() platform.AdapterDefinition {
	return platform.AdapterDefinition{Code: platform.AdapterLoRaWANV2, SourceTypes: []string{"http_api"}, PayloadTypes: []string{"json"}, OptionalMapping: true}
}
