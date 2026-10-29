package lorawanv2

import (
	"encoding/json"
	"net/url"
	"thcpn-gin/internal/apperr"
	"thcpn-gin/internal/objectstore"
	"time"
)

// ResolveLogURLs keeps source object keys separate from browser navigation URLs.
func ResolveLogURLs(payload json.RawMessage, signer *objectstore.Signer) (json.RawMessage, error) {
	var root map[string]json.RawMessage
	if err := json.Unmarshal(payload, &root); err != nil || root == nil {
		return nil, apperr.New(apperr.KindDataSource, "invalid gateway log response")
	}
	// Accept both the client-unwrapped payload and the upstream envelope.
	if nested, ok := root["payload"]; ok {
		resolved, err := ResolveLogURLs(nested, signer)
		if err != nil {
			return nil, err
		}
		root["payload"] = resolved
	} else {
		var rows []map[string]json.RawMessage
		if err := json.Unmarshal(root["data"], &rows); err != nil {
			return nil, apperr.New(apperr.KindDataSource, "invalid gateway log list")
		}
		for _, row := range rows {
			delete(row, "file_url")
			delete(row, "file_url_error")
			var key string
			_ = json.Unmarshal(row["file"], &key)
			if key == "" {
				continue
			}
			message := "日志文件地址不可用"
			parsed, parseErr := url.Parse(key)
			if signer != nil && parseErr == nil && (parsed.Scheme == "" || parsed.Scheme == "http" || parsed.Scheme == "https") {
				normalized, err := signer.NormalizeObjectKey(key)
				if err == nil {
					signed, err := signer.SignObjectURL(normalized, 15*time.Minute)
					if err == nil {
						row["file_url"], _ = json.Marshal(signed.URL)
						continue
					}
				}
			}
			row["file_url_error"], _ = json.Marshal(message)
		}
		root["data"], _ = json.Marshal(rows)
	}
	return json.Marshal(root)
}
