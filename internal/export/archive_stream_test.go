package export

import (
	"archive/zip"
	"bytes"
	"io"
	"os"
	"runtime"
	"testing"
)

func TestImagesAreStoredWithoutRecompression(t *testing.T) {
	var out bytes.Buffer
	zw := zip.NewWriter(&out)
	if err := writeObjectFile(zw, "images/photo.jpg", bytes.NewBufferString("jpeg")); err != nil {
		t.Fatal(err)
	}
	if err := zw.Close(); err != nil {
		t.Fatal(err)
	}
	zr, err := zip.NewReader(bytes.NewReader(out.Bytes()), int64(out.Len()))
	if err != nil {
		t.Fatal(err)
	}
	if zr.File[0].Method != zip.Store {
		t.Fatal("image is unnecessarily recompressed")
	}
}

type endlessImage struct{}

func (endlessImage) Read(b []byte) (int, error) { clear(b); return len(b), nil }

func TestArchiveImagesUseBoundedMemory(t *testing.T) {
	file, err := os.CreateTemp(t.TempDir(), "archive-*.zip")
	if err != nil {
		t.Fatal(err)
	}
	defer file.Close()
	var before, after runtime.MemStats
	runtime.GC()
	runtime.ReadMemStats(&before)
	zw := zip.NewWriter(file)
	if err = writeObjectFile(zw, "image.jpg", io.LimitReader(endlessImage{}, 64<<20)); err != nil {
		t.Fatal(err)
	}
	if err = zw.Close(); err != nil {
		t.Fatal(err)
	}
	runtime.ReadMemStats(&after)
	if allocated := after.TotalAlloc - before.TotalAlloc; allocated > 16<<20 {
		t.Fatalf("64MiB image used %d bytes of heap", allocated)
	}
	stat, err := file.Stat()
	if err != nil || stat.Size() < 64<<20 {
		t.Fatal("image was not streamed completely")
	}
}
