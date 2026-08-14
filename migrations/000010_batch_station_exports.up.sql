ALTER TABLE public.export_jobs
    DROP CONSTRAINT IF EXISTS export_jobs_resource_type_check;

ALTER TABLE public.export_jobs
    ADD CONSTRAINT export_jobs_resource_type_check
    CHECK (resource_type = ANY (ARRAY[
        'device'::text,
        'device_batch'::text,
        'data_stream'::text,
        'dataset'::text,
        'media'::text
    ]));

ALTER TABLE public.export_jobs
    DROP CONSTRAINT IF EXISTS export_jobs_export_type_check;

ALTER TABLE public.export_jobs
    ADD CONSTRAINT export_jobs_export_type_check
    CHECK (export_type = ANY (ARRAY[
        'telemetry_csv'::text,
        'telemetry_excel'::text,
        'media_zip'::text,
        'dataset_zip'::text,
        'carbon_flux_csv'::text,
        'carbon_raw_csv'::text,
        'standard_station_zip'::text,
        'group_site_zip'::text
    ]));

COMMENT ON COLUMN public.export_jobs.resource_id IS '单资源导出使用目标资源；device_batch 导出使用首个设备作为权限锚点，完整设备列表保存在 request_config_json.device_ids。';
