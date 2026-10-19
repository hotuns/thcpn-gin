package thcpn

import (
	"thcpn-gin/internal/datasource/platform"
)

// Service owns this source's protocol and platform projection. It never imports another source.
type Service struct{ *platform.Service }

func New(p *platform.Service) *Service { return &Service{Service: p} }

type Runtime struct{ *platform.Runtime }
