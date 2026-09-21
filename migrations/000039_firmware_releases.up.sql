CREATE TABLE firmware_releases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  original_filename text NOT NULL CHECK (btrim(original_filename) <> ''),
  object_key text NOT NULL UNIQUE CHECK (btrim(object_key) <> ''),
  public_url text NOT NULL CHECK (btrim(public_url) <> ''),
  content_type text NOT NULL DEFAULT 'application/octet-stream',
  size_bytes bigint NOT NULL CHECK (size_bytes > 0),
  version text NOT NULL CHECK (btrim(version) <> '' AND length(version) <= 96),
  firmware_version bigint NOT NULL CHECK (firmware_version BETWEEN 0 AND 4294967295),
  verify_value text NOT NULL CHECK (verify_value ~ '^[0-9A-Fa-f]{32}$'),
  source_family text NOT NULL DEFAULT 'lorawan_v2' CHECK (source_family IN ('thcpn','carbon','lorawan_v2')),
  build_id bigint CHECK (build_id IS NULL OR build_id > 0),
  status text NOT NULL DEFAULT 'publishing' CHECK (status IN ('publishing','partial','completed','failed')),
  created_by uuid REFERENCES system_admins(id) ON DELETE SET NULL,
  idempotency_key uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX firmware_releases_admin_idempotency_idx ON firmware_releases(created_by, idempotency_key);

CREATE TABLE firmware_release_targets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  release_id uuid NOT NULL REFERENCES firmware_releases(id) ON DELETE CASCADE,
  device_id uuid NOT NULL REFERENCES devices(id) ON DELETE RESTRICT,
  data_source_id uuid NOT NULL REFERENCES data_sources(id) ON DELETE RESTRICT,
  gateway_sn text CHECK (gateway_sn IS NULL OR btrim(gateway_sn) <> ''),
  external_device_id bigint CHECK (external_device_id IS NULL OR external_device_id > 0),
  upstream_firmware_id bigint,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','publishing','completed','failed')),
  retry_count integer NOT NULL DEFAULT 0 CHECK (retry_count >= 0),
  error_message text,
  published_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (release_id, device_id)
);

ALTER TABLE firmware_release_targets ADD CONSTRAINT firmware_release_target_identity_check CHECK (
  (gateway_sn IS NOT NULL AND external_device_id IS NULL)
  OR (gateway_sn IS NULL AND external_device_id IS NOT NULL)
);

CREATE INDEX firmware_releases_created_at_idx ON firmware_releases(created_at DESC);
CREATE INDEX firmware_release_targets_release_idx ON firmware_release_targets(release_id, status);
CREATE INDEX firmware_release_targets_device_idx ON firmware_release_targets(device_id, created_at DESC);

COMMENT ON TABLE firmware_releases IS 'Source-owned firmware artifacts published to supported devices.';
COMMENT ON TABLE firmware_release_targets IS 'Per-device source firmware registration results.';

-- All supported families publish to their own OSS and register in their
-- source-native API or firmware table.
INSERT INTO device_capabilities(device_id, capability_code)
SELECT DISTINCT ref.device_id, 'firmware_update'
FROM device_source_refs ref
JOIN data_sources source ON source.id = ref.data_source_id
WHERE ref.adapter_code IN ('lorawan_v2','thcpn_legacy_mysql','carbon_sink_mysql')
  AND ref.status = 'active'
  AND source.source_family IN ('thcpn','carbon','lorawan_v2')
  AND source.status = 'active'
ON CONFLICT (device_id, capability_code) DO NOTHING;
