package deviceclaim

import (
	"strings"
	"testing"

	"github.com/google/uuid"
	"thcpn-gin/internal/testdb"
)

func TestAssetNumberMigrationPreservesPrintedCredentials(t *testing.T) {
	db := testdb.Open(t, 56)
	ctx := t.Context()
	gateway := uuid.New()
	legacy := "6C9AA36EEE9EC7A57DB6"
	if _, err := db.Exec(ctx, `INSERT INTO devices(id,name,serial_no,device_type) VALUES($1,'existing gateway',$2,'gateway')`, gateway, legacy); err != nil {
		t.Fatal(err)
	}
	service := NewService(db, "isolated-test-secret")
	if _, err := service.EnsureForDevice(ctx, gateway); err != nil {
		t.Fatal(err)
	}
	if err := service.MarkPrinted(ctx, gateway); err != nil {
		t.Fatal(err)
	}
	var slugCipher, slugNonce, codeCipher, codeNonce []byte
	if err := db.QueryRow(ctx, `SELECT claim_slug_ciphertext,claim_slug_nonce,manual_code_ciphertext,manual_code_nonce
  FROM device_claim_credentials WHERE device_id=$1`, gateway).Scan(&slugCipher, &slugNonce, &codeCipher, &codeNonce); err != nil {
		t.Fatal(err)
	}
	slug, err := service.decrypt(slugCipher, slugNonce)
	if err != nil {
		t.Fatal(err)
	}
	code, err := service.decrypt(codeCipher, codeNonce)
	if err != nil {
		t.Fatal(err)
	}

	const up = "../../migrations/000057_asset_numbers.up.sql"
	const down = "../../migrations/000057_asset_numbers.down.sql"
	testdb.Apply(t, db, up)
	credential, err := service.GetAdminCredential(ctx, gateway)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(credential.AssetNo, "LR-") || credential.SerialNo != legacy || credential.ClaimSlug != slug || credential.ManualCode != formatManualCode(code) || credential.PrintedAt == nil {
		t.Fatal("migration changed the printed identity or did not issue an LR asset number")
	}
	for _, input := range []ResolveInput{{ClaimSlug: slug}, {SerialNo: strings.ToLower(legacy), Code: code}, {SerialNo: credential.AssetNo, Code: code}} {
		got, err := service.Resolve(ctx, input)
		if err != nil || got.DeviceID != gateway {
			t.Fatalf("printed or new identity did not resolve to the same device: %v", err)
		}
	}

	for role, prefix := range map[string]string{"standalone": "ZC-", "gateway_node": "LR-", "carbon_sink": "CS-", "camera": "VD-"} {
		id := uuid.New()
		// Imports insert first and set the role in the same transaction.
		tx, err := db.Begin(ctx)
		if err != nil {
			t.Fatal(err)
		}
		if _, err = tx.Exec(ctx, `INSERT INTO devices(id,name) VALUES($1,'new asset')`, id); err != nil {
			_ = tx.Rollback(ctx)
			t.Fatal(err)
		}
		if _, err = tx.Exec(ctx, `UPDATE devices SET device_type=$2 WHERE id=$1`, id, role); err != nil {
			_ = tx.Rollback(ctx)
			t.Fatal(err)
		}
		if err = tx.Commit(ctx); err != nil {
			t.Fatal(err)
		}
		var asset string
		if err = db.QueryRow(ctx, `SELECT asset_no FROM devices WHERE id=$1`, id).Scan(&asset); err != nil || len(asset) != 11 || !strings.HasPrefix(asset, prefix) {
			t.Fatalf("role %s got %q: %v", role, asset, err)
		}
		if _, err = db.Exec(ctx, `UPDATE devices SET device_type='gateway' WHERE id=$1`, id); err != nil {
			t.Fatal(err)
		}
		var after string
		if err = db.QueryRow(ctx, `SELECT asset_no FROM devices WHERE id=$1`, id).Scan(&after); err != nil || after != asset {
			t.Fatalf("classification update changed asset number: %v", err)
		}
	}
	testdb.Apply(t, db, down)
	var unchanged string
	if err := db.QueryRow(ctx, `SELECT serial_no FROM devices WHERE id=$1`, gateway).Scan(&unchanged); err != nil || unchanged != legacy {
		t.Fatalf("rollback changed legacy serial: %v", err)
	}
	testdb.Apply(t, db, up)
	if _, err := service.Resolve(ctx, ResolveInput{ClaimSlug: slug}); err != nil {
		t.Fatal(err)
	}
}
