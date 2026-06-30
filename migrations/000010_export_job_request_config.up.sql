ALTER TABLE export_jobs
    ADD COLUMN request_config_json jsonb NOT NULL DEFAULT '{}'::jsonb,
    ADD CONSTRAINT export_jobs_request_config_object_check
        CHECK (jsonb_typeof(request_config_json) = 'object');
