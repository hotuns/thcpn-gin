ALTER TABLE public.export_jobs
    DROP CONSTRAINT export_jobs_export_type_check,
    ADD CONSTRAINT export_jobs_export_type_check CHECK (
        export_type IN ('telemetry_csv', 'telemetry_excel', 'media_zip', 'dataset_zip',
                        'standard_station_zip', 'group_site_zip', 'carbon_station_zip')
        OR (export_type = 'admin_device_bundle_zip' AND requested_by_admin IS NOT NULL AND resource_type = 'device_batch')
    );
