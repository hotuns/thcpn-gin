package thcpn

import "thcpn-gin/internal/datasource/platform"

func BindingDefinition() platform.AdapterDefinition {
	return platform.AdapterDefinition{Code: platform.AdapterTHCPNLegacy, SourceTypes: []string{"mysql"}, PayloadTypes: []string{"columns", "json", "media"}, OptionalMapping: true}
}
