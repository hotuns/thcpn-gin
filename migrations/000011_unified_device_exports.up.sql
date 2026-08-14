ALTER TABLE public.export_jobs
    DROP CONSTRAINT IF EXISTS export_jobs_export_type_check;

ALTER TABLE public.export_jobs
    ADD CONSTRAINT export_jobs_export_type_check
    CHECK (export_type = ANY (ARRAY[
        'telemetry_csv'::text,
        'telemetry_excel'::text,
        'media_zip'::text,
        'dataset_zip'::text,
        'standard_station_zip'::text,
        'group_site_zip'::text,
        'carbon_station_zip'::text
    ]));
