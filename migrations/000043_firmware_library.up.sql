CREATE TABLE firmware_artifacts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 data_source_id uuid NOT NULL REFERENCES data_sources(id) ON DELETE RESTRICT,
 source_family text NOT NULL CHECK(source_family IN ('lorawan_v2','thcpn','carbon')),
 device_type text NOT NULL,
 product_id text,
 original_filename text NOT NULL,
 object_key text NOT NULL UNIQUE,
 public_url text NOT NULL,
 content_type text NOT NULL,
 size_bytes bigint NOT NULL CHECK(size_bytes>0),
 version text NOT NULL,
 firmware_version bigint NOT NULL CHECK(firmware_version BETWEEN 0 AND 4294967295),
 verify_value text NOT NULL CHECK(verify_value ~ '^[0-9A-Fa-f]{32}$'),
 build_id bigint CHECK(build_id>0),
 archived boolean NOT NULL DEFAULT false,
 created_by uuid REFERENCES system_admins(id) ON DELETE SET NULL,
 idempotency_key uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(created_by,idempotency_key)
);
ALTER TABLE firmware_releases ADD COLUMN firmware_id uuid REFERENCES firmware_artifacts(id) ON DELETE RESTRICT;
ALTER TABLE firmware_releases DROP CONSTRAINT firmware_releases_object_key_key;
CREATE INDEX firmware_artifacts_source_idx ON firmware_artifacts(data_source_id,device_type,created_at DESC);
-- Reuse historical files only when all targets prove a single compatibility scope.
INSERT INTO firmware_artifacts(id,data_source_id,source_family,device_type,product_id,original_filename,object_key,public_url,content_type,size_bytes,version,firmware_version,verify_value,build_id,created_by,idempotency_key,created_at)
SELECT r.id,min(t.data_source_id::text)::uuid,r.source_family,min(d.device_type),min(d.product_id),r.original_filename,r.object_key,r.public_url,r.content_type,r.size_bytes,r.version,r.firmware_version,r.verify_value,r.build_id,r.created_by,r.idempotency_key,r.created_at
FROM firmware_releases r JOIN firmware_release_targets t ON t.release_id=r.id JOIN devices d ON d.id=t.device_id
GROUP BY r.id HAVING count(DISTINCT t.data_source_id)=1 AND count(DISTINCT d.device_type)=1 AND count(DISTINCT jsonb_build_array(d.product_id))=1;
UPDATE firmware_releases r SET firmware_id=a.id FROM firmware_artifacts a WHERE a.id=r.id;
