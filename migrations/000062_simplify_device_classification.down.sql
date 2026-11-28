-- Restore legacy environment tables and taxonomy constraints.

DROP INDEX IF EXISTS devices_product_term_idx;
DROP INDEX IF EXISTS devices_ecosystem_term_idx;
DROP INDEX IF EXISTS sites_ecosystem_term_idx;

CREATE TABLE IF NOT EXISTS public.device_environment_profiles (
    device_id uuid PRIMARY KEY REFERENCES public.devices(id) ON DELETE CASCADE,
    ecosystem_term_id uuid REFERENCES public.device_taxonomy_terms(id) ON DELETE RESTRICT,
    management_term_id uuid REFERENCES public.device_taxonomy_terms(id) ON DELETE RESTRICT,
    deployment_term_id uuid REFERENCES public.device_taxonomy_terms(id) ON DELETE RESTRICT,
    commissioned_year integer,
    research_tags text[] DEFAULT '{}'::text[] NOT NULL,
    overridden_fields text[] DEFAULT '{}'::text[] NOT NULL,
    updated_by uuid,
    updated_actor_type text DEFAULT 'user'::text NOT NULL,
    created_at timestamptz DEFAULT now() NOT NULL,
    updated_at timestamptz DEFAULT now() NOT NULL,
    CONSTRAINT device_environment_profiles_commissioned_year_check CHECK (((commissioned_year IS NULL) OR ((commissioned_year >= 1900) AND (commissioned_year <= 2200)))),
    CONSTRAINT device_environment_profiles_overridden_fields_check CHECK ((overridden_fields <@ ARRAY['ecosystem'::text, 'observation_objects'::text, 'purposes'::text, 'management'::text, 'deployment'::text, 'commissioned_year'::text, 'research_tags'::text])),
    CONSTRAINT device_environment_profiles_updated_actor_type_check CHECK ((updated_actor_type = ANY (ARRAY['user'::text, 'system_admin'::text])))
);

CREATE TABLE IF NOT EXISTS public.device_environment_terms (
    device_id uuid NOT NULL REFERENCES public.devices(id) ON DELETE CASCADE,
    term_id uuid NOT NULL REFERENCES public.device_taxonomy_terms(id) ON DELETE RESTRICT,
    PRIMARY KEY (device_id, term_id)
);

CREATE TABLE IF NOT EXISTS public.site_environment_profiles (
    site_id uuid PRIMARY KEY REFERENCES public.sites(id) ON DELETE CASCADE,
    ecosystem_term_id uuid REFERENCES public.device_taxonomy_terms(id) ON DELETE RESTRICT,
    management_term_id uuid REFERENCES public.device_taxonomy_terms(id) ON DELETE RESTRICT,
    deployment_term_id uuid REFERENCES public.device_taxonomy_terms(id) ON DELETE RESTRICT,
    altitude_m double precision,
    commissioned_year integer,
    research_tags text[] DEFAULT '{}'::text[] NOT NULL,
    updated_by uuid,
    updated_actor_type text DEFAULT 'user'::text NOT NULL,
    created_at timestamptz DEFAULT now() NOT NULL,
    updated_at timestamptz DEFAULT now() NOT NULL,
    CONSTRAINT site_environment_profiles_commissioned_year_check CHECK (((commissioned_year IS NULL) OR ((commissioned_year >= 1900) AND (commissioned_year <= 2200)))),
    CONSTRAINT site_environment_profiles_updated_actor_type_check CHECK ((updated_actor_type = ANY (ARRAY['user'::text, 'system_admin'::text])))
);

CREATE TABLE IF NOT EXISTS public.site_environment_terms (
    site_id uuid NOT NULL REFERENCES public.sites(id) ON DELETE CASCADE,
    term_id uuid NOT NULL REFERENCES public.device_taxonomy_terms(id) ON DELETE RESTRICT,
    PRIMARY KEY (site_id, term_id)
);

INSERT INTO site_environment_profiles (site_id, ecosystem_term_id, altitude_m)
SELECT id, ecosystem_term_id, altitude_m
FROM sites
WHERE ecosystem_term_id IS NOT NULL OR altitude_m IS NOT NULL
ON CONFLICT (site_id) DO NOTHING;

INSERT INTO device_environment_profiles (device_id, ecosystem_term_id, overridden_fields)
SELECT id, ecosystem_term_id, ARRAY['ecosystem'::text]
FROM devices
WHERE ecosystem_term_id IS NOT NULL
ON CONFLICT (device_id) DO NOTHING;

ALTER TABLE devices
    DROP COLUMN IF EXISTS product_term_id,
    DROP COLUMN IF EXISTS ecosystem_term_id;

ALTER TABLE sites
    DROP COLUMN IF EXISTS ecosystem_term_id,
    DROP COLUMN IF EXISTS altitude_m;

UPDATE device_taxonomy_terms kept SET parent_id = NULL
FROM device_taxonomy_terms parent
WHERE kept.parent_id = parent.id AND kept.kind = 'ecosystem' AND parent.kind = 'product';

DELETE FROM device_taxonomy_terms WHERE kind = 'product';

ALTER TABLE device_taxonomy_terms
    DROP CONSTRAINT IF EXISTS device_taxonomy_terms_kind_check;

ALTER TABLE device_taxonomy_terms
    ADD CONSTRAINT device_taxonomy_terms_kind_check
    CHECK (kind IN ('ecosystem', 'observation_object', 'purpose', 'management', 'deployment'));

-- Restore the built-in options expected by the previous version.
INSERT INTO device_taxonomy_terms (kind,code,name_zh,name_en,sort_order,system_defined) VALUES
('observation_object','atmosphere','大气','Atmosphere',10,true),
('observation_object','soil','土壤','Soil',20,true),
('observation_object','plant','植物','Plant',30,true),
('observation_object','tree','树木','Tree',40,true),
('observation_object','grassland_community','草地群落','Grassland community',50,true),
('observation_object','dust','沙尘','Dust',60,true),
('observation_object','water_body','水体','Water body',70,true),
('purpose','dust_monitoring','沙尘监测','Dust monitoring',10,true),
('purpose','tree_radial_growth','树木径向生长监测','Tree radial growth monitoring',20,true),
('purpose','plant_phenology','植物物候监测','Plant phenology monitoring',30,true),
('purpose','grassland_restoration','草原生态修复评估','Grassland restoration assessment',40,true),
('purpose','crop_growth','农作物生长监测','Crop growth monitoring',50,true),
('purpose','forest_ecology','森林生态监测','Forest ecology monitoring',60,true),
('purpose','soil_environment','土壤环境监测','Soil environment monitoring',70,true),
('purpose','microclimate','小气候监测','Microclimate monitoring',80,true),
('purpose','hydrology','水文监测','Hydrology monitoring',90,true),
('purpose','method_validation','设备与方法验证','Equipment and method validation',100,true),
('purpose','other','其他','Other',999,true),
('management','natural','天然','Natural',10,true),
('management','managed','人工','Managed',20,true),
('management','experimental','试验处理','Experimental treatment',30,true),
('deployment','outdoor','室外','Outdoor',10,true),
('deployment','greenhouse','温室','Greenhouse',20,true),
('deployment','indoor','室内','Indoor',30,true);

CREATE INDEX device_environment_profiles_deployment_idx ON public.device_environment_profiles USING btree (deployment_term_id);
CREATE INDEX device_environment_profiles_ecosystem_idx ON public.device_environment_profiles USING btree (ecosystem_term_id);
CREATE INDEX device_environment_profiles_management_idx ON public.device_environment_profiles USING btree (management_term_id);
CREATE INDEX device_environment_terms_term_idx ON public.device_environment_terms USING btree (term_id, device_id);
CREATE INDEX site_environment_terms_term_idx ON public.site_environment_terms USING btree (term_id, site_id);
