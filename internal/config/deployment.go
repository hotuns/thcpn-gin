package config

import (
	"errors"
	"net/url"
	"strconv"
	"strings"
	"unicode/utf8"
)

// NormalizePublicBaseURL accepts an HTTP(S) origin, including local deployments.
// An empty value leaves browser-origin fallback available to clients.
func NormalizePublicBaseURL(value string) (string, error) {
	value = strings.TrimSpace(value)
	if value == "" {
		return "", nil
	}
	if utf8.RuneCountInString(value) > 2048 {
		return "", errors.New("平台访问地址不能超过 2048 个字符")
	}
	invalid := errors.New("平台访问地址须为完整的 http:// 或 https:// 地址，可包含端口，不能包含账号密码、路径、查询参数或锚点")
	u, err := url.Parse(value)
	if err != nil {
		return "", invalid
	}
	scheme := strings.ToLower(u.Scheme)
	if (scheme != "http" && scheme != "https") || u.Hostname() == "" || u.User != nil ||
		(u.EscapedPath() != "" && u.EscapedPath() != "/") || u.RawQuery != "" || u.ForceQuery ||
		strings.Contains(value, "#") || u.Opaque != "" {
		return "", invalid
	}
	if port := u.Port(); port != "" {
		n, err := strconv.Atoi(port)
		if err != nil || n < 1 || n > 65535 {
			return "", invalid
		}
	} else if strings.HasSuffix(u.Host, ":") {
		return "", invalid
	}
	return scheme + "://" + strings.ToLower(u.Host), nil
}
