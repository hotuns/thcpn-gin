-- Simplify device and site classification:
-- 1. Keep only 'ecosystem' and 'product' terms in device_taxonomy_terms.
-- 2. Store ecosystem_term_id & altitude_m directly on sites, and product_term_id & ecosystem_term_id directly on devices.
-- 3. Remove the 4 redundant environment profile/term join tables after migrating existing values.

ALTER TABLE sites
    ADD COLUMN IF NOT EXISTS ecosystem_term_id uuid REFERENCES device_taxonomy_terms(id) ON DELETE RESTRICT,
    ADD COLUMN IF NOT EXISTS altitude_m double precision;

ALTER TABLE devices
    ADD COLUMN IF NOT EXISTS product_term_id uuid REFERENCES device_taxonomy_terms(id) ON DELETE RESTRICT,
    ADD COLUMN IF NOT EXISTS ecosystem_term_id uuid REFERENCES device_taxonomy_terms(id) ON DELETE RESTRICT;

COMMENT ON COLUMN sites.ecosystem_term_id IS '样地生态分类词条（kind=ecosystem），归属设备默认继承。';
COMMENT ON COLUMN sites.altitude_m IS '样地海拔（米）。';
COMMENT ON COLUMN devices.product_term_id IS '设备产品名称词条（kind=product），设备固有属性，不从样地继承。';
COMMENT ON COLUMN devices.ecosystem_term_id IS '设备生态分类词条（kind=ecosystem）；为空时自动沿用网关或样地生态分类。';

-- Preserve any remaining legacy research_tags in device_workspace_tags for active workspace assignments.
INSERT INTO device_workspace_tags (device_id, workspace_id, tags)
SELECT p.device_id, a.workspace_id, p.research_tags
FROM device_environment_profiles p
JOIN device_assignments a ON a.device_id = p.device_id AND a.status = 'active'
WHERE cardinality(p.research_tags) > 0
ON CONFLICT (device_id, workspace_id) DO NOTHING;

-- Backfill site ecosystem and altitude from site_environment_profiles.
UPDATE sites s
SET description = CASE WHEN cardinality(p.research_tags) > 0 THEN
        concat_ws(E'\n', NULLIF(s.description, ''), '研究方向：' || array_to_string(p.research_tags, '、'))
        ELSE s.description END,
    ecosystem_term_id = CASE
        WHEN t.id IS NOT NULL THEN p.ecosystem_term_id
        ELSE s.ecosystem_term_id
    END,
    altitude_m = COALESCE(p.altitude_m, s.altitude_m)
FROM site_environment_profiles p
LEFT JOIN device_taxonomy_terms t ON t.id = p.ecosystem_term_id AND t.kind = 'ecosystem'
WHERE s.id = p.site_id;

-- Backfill explicit device-level ecosystem overrides from device_environment_profiles.
UPDATE devices d
SET ecosystem_term_id = p.ecosystem_term_id
FROM device_environment_profiles p
JOIN device_taxonomy_terms t ON t.id = p.ecosystem_term_id AND t.kind = 'ecosystem'
WHERE d.id = p.device_id
  AND 'ecosystem' = ANY(p.overridden_fields);

-- Drop the 4 redundant environment tables.
DROP TABLE IF EXISTS device_environment_terms;
DROP TABLE IF EXISTS site_environment_terms;
DROP TABLE IF EXISTS device_environment_profiles;
DROP TABLE IF EXISTS site_environment_profiles;

-- Restrict device_taxonomy_terms to ecosystem and product only.
UPDATE device_taxonomy_terms kept SET parent_id = NULL
FROM device_taxonomy_terms parent
WHERE kept.parent_id = parent.id AND kept.kind IN ('ecosystem', 'product')
  AND parent.kind NOT IN ('ecosystem', 'product');

DELETE FROM device_taxonomy_terms
WHERE kind NOT IN ('ecosystem', 'product');

ALTER TABLE device_taxonomy_terms
    DROP CONSTRAINT IF EXISTS device_taxonomy_terms_kind_check;

ALTER TABLE device_taxonomy_terms
    ADD CONSTRAINT device_taxonomy_terms_kind_check
    CHECK (kind IN ('ecosystem', 'product'));

COMMENT ON TABLE device_taxonomy_terms IS '设备生态分类（ecosystem）与产品名称（product）中英文元数据字典。';

CREATE INDEX IF NOT EXISTS devices_product_term_idx
    ON devices (product_term_id)
    WHERE product_term_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS devices_ecosystem_term_idx
    ON devices (ecosystem_term_id)
    WHERE ecosystem_term_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS sites_ecosystem_term_idx
    ON sites (ecosystem_term_id)
    WHERE ecosystem_term_id IS NOT NULL;
