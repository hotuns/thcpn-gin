ALTER TABLE public.data_sources
    ADD COLUMN source_family text;

ALTER TABLE public.data_sources
    ADD CONSTRAINT data_sources_source_family_check
    CHECK (source_family IS NULL OR source_family = ANY (ARRAY['thcpn'::text, 'carbon'::text]));

WITH source_ref_families AS (
    SELECT
        data_source_id,
        bool_or(adapter_code IN ('thcpn_legacy_mysql', 'thcpn_legacy_camera')) AS has_thcpn,
        bool_or(adapter_code = 'carbon_sink_mysql') AS has_carbon,
        bool_or(adapter_code NOT IN ('thcpn_legacy_mysql', 'thcpn_legacy_camera', 'carbon_sink_mysql')) AS has_unknown
    FROM public.device_source_refs
    GROUP BY data_source_id
)
UPDATE public.data_sources AS source
SET source_family = CASE
    WHEN refs.has_thcpn AND NOT refs.has_carbon AND NOT refs.has_unknown THEN 'thcpn'
    WHEN refs.has_carbon AND NOT refs.has_thcpn AND NOT refs.has_unknown THEN 'carbon'
    ELSE NULL
END
FROM source_ref_families AS refs
WHERE source.id = refs.data_source_id
  AND source.type = 'mysql';

UPDATE public.data_sources AS source
SET source_family = CASE
    WHEN lower(source.dsn_secret_ref) LIKE '%thcpn%'
         AND lower(source.dsn_secret_ref) NOT LIKE '%carbon%' THEN 'thcpn'
    WHEN lower(source.dsn_secret_ref) LIKE '%carbon%'
         AND lower(source.dsn_secret_ref) NOT LIKE '%thcpn%' THEN 'carbon'
    ELSE NULL
END
WHERE source.type = 'mysql'
  AND source.source_family IS NULL
  AND NOT EXISTS (
      SELECT 1
      FROM public.device_source_refs AS ref
      WHERE ref.data_source_id = source.id
  )
  AND (
      lower(source.dsn_secret_ref) LIKE '%thcpn%'
      OR lower(source.dsn_secret_ref) LIKE '%carbon%'
  );
