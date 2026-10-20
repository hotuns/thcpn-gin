package objectstore

import (
	"bytes"
	"context"
	"encoding/xml"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"time"
)

const multipartPartSize = 16 << 20

type contextReader struct {
	ctx    context.Context
	reader io.Reader
}

func (r *contextReader) Read(b []byte) (int, error) {
	if err := r.ctx.Err(); err != nil {
		return 0, err
	}
	return r.reader.Read(b)
}

// Unknown-size callers are spooled to disk, never an unbounded byte slice.
func seekableBody(ctx context.Context, reader io.Reader) (io.ReadSeeker, int64, func(), error) {
	if body, ok := reader.(io.ReadSeeker); ok {
		start, err := body.Seek(0, io.SeekCurrent)
		if err != nil {
			return nil, 0, func() {}, err
		}
		end, err := body.Seek(0, io.SeekEnd)
		if err != nil {
			return nil, 0, func() {}, err
		}
		_, err = body.Seek(start, io.SeekStart)
		return body, end - start, func() {}, err
	}
	file, err := os.CreateTemp("", "thcpn-upload-*.tmp")
	if err != nil {
		return nil, 0, func() {}, err
	}
	cleanup := func() { file.Close(); os.Remove(file.Name()) }
	size, err := io.Copy(file, &contextReader{ctx: ctx, reader: reader})
	if err != nil {
		cleanup()
		return nil, 0, func() {}, err
	}
	if _, err = file.Seek(0, io.SeekStart); err != nil {
		cleanup()
		return nil, 0, func() {}, err
	}
	return file, size, cleanup, nil
}

type uploadedPart struct {
	Number int    `xml:"PartNumber"`
	ETag   string `xml:"ETag"`
}

func (s *S3Store) putMultipart(ctx context.Context, key, contentType string, body io.ReadSeeker, size int64) (err error) {
	partSize := int64(multipartPartSize)
	if needed := (size + 9999) / 10000; needed > partSize {
		partSize = needed
	}
	if partSize > 64<<20 {
		return errors.New("object exceeds multipart upload size limit")
	}
	response, err := s.multipartRequest(ctx, "POST", key, url.Values{"uploads": {""}}, nil, contentType)
	if err != nil {
		return err
	}
	var initiated struct {
		UploadID string `xml:"UploadId"`
	}
	err = xml.Unmarshal(response, &initiated)
	if err != nil || initiated.UploadID == "" {
		return errors.New("invalid multipart initiation response")
	}
	complete := false
	defer func() {
		if !complete {
			cleanup, cancel := context.WithTimeout(context.Background(), 30*time.Second)
			defer cancel()
			if _, abortErr := s.multipartRequest(cleanup, "DELETE", key, url.Values{"uploadId": {initiated.UploadID}}, nil, ""); abortErr != nil {
				err = errors.Join(err, errors.New("multipart abort failed; object-store lifecycle cleanup is required"))
			}
		}
	}()
	parts := []uploadedPart{}
	buffer := make([]byte, int(partSize))
	for number := 1; ; number++ {
		n, readErr := io.ReadFull(&contextReader{ctx: ctx, reader: body}, buffer)
		if readErr != nil && readErr != io.EOF && readErr != io.ErrUnexpectedEOF {
			return readErr
		}
		if n == 0 {
			break
		}
		query := url.Values{"uploadId": {initiated.UploadID}, "partNumber": {strconv.Itoa(number)}}
		var etag string
		for attempt := 0; attempt < 3; attempt++ {
			etag, err = s.uploadPart(ctx, key, query, buffer[:n])
			if err == nil {
				break
			}
			timer := time.NewTimer(time.Duration(attempt+1) * 200 * time.Millisecond)
			select {
			case <-ctx.Done():
				timer.Stop()
				return ctx.Err()
			case <-timer.C:
			}
		}
		if err != nil {
			return err
		}
		parts = append(parts, uploadedPart{Number: number, ETag: etag})
		if readErr != nil {
			break
		}
	}
	payload, err := xml.Marshal(struct {
		XMLName xml.Name       `xml:"CompleteMultipartUpload"`
		Parts   []uploadedPart `xml:"Part"`
	}{Parts: parts})
	if err != nil {
		return err
	}
	response, err = s.multipartRequest(ctx, "POST", key, url.Values{"uploadId": {initiated.UploadID}}, bytes.NewReader(payload), "application/xml")
	if err != nil {
		return err
	}
	var result struct{ XMLName xml.Name }
	if err = xml.Unmarshal(response, &result); err != nil {
		return err
	}
	if result.XMLName.Local != "CompleteMultipartUploadResult" {
		return errors.New("multipart completion returned an error")
	}
	complete = true
	return nil
}

func (s *S3Store) uploadPart(ctx context.Context, key string, query url.Values, data []byte) (string, error) {
	req, err := s.newSignedRequest(ctx, "PUT", key, bytes.NewReader(data), "application/octet-stream", query)
	if err != nil {
		return "", err
	}
	client := s.client
	if client == nil {
		client = http.DefaultClient
	}
	resp, err := client.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	io.Copy(io.Discard, io.LimitReader(resp.Body, 1<<20))
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return "", fmt.Errorf("upload part failed: HTTP %d", resp.StatusCode)
	}
	etag := resp.Header.Get("ETag")
	if etag == "" {
		return "", errors.New("upload part missing ETag")
	}
	return etag, nil
}
func (s *S3Store) multipartRequest(ctx context.Context, method, key string, query url.Values, body io.Reader, contentType string) ([]byte, error) {
	req, err := s.newSignedRequest(ctx, method, key, body, contentType, query)
	if err != nil {
		return nil, err
	}
	client := s.client
	if client == nil {
		client = http.DefaultClient
	}
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("multipart request failed: HTTP %d", resp.StatusCode)
	}
	return io.ReadAll(io.LimitReader(resp.Body, 1<<20))
}
