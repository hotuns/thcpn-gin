CREATE TABLE processing_plans (
    id uuid PRIMARY KEY,
    code varchar(64) NOT NULL UNIQUE,
    name varchar(128) NOT NULL,
    description text NOT NULL DEFAULT '',
    status varchar(16) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'disabled')),
    current_version integer NOT NULL DEFAULT 1,
    published_version integer,
    created_by uuid REFERENCES system_admins(id),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE processing_plan_versions (
    plan_id uuid NOT NULL REFERENCES processing_plans(id) ON DELETE CASCADE,
    version integer NOT NULL,
    processor_code varchar(64) NOT NULL,
    processor_version varchar(32) NOT NULL,
    processor_manifest_json jsonb NOT NULL,
    parameters_json jsonb NOT NULL DEFAULT '{}'::jsonb,
    trigger_json jsonb NOT NULL DEFAULT '{"mode":"each_input"}'::jsonb,
    target_types_json jsonb NOT NULL DEFAULT '["device"]'::jsonb,
    created_by uuid REFERENCES system_admins(id),
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (plan_id, version),
    FOREIGN KEY (processor_code, processor_version) REFERENCES processing_processors(code, version)
);

ALTER TABLE processing_task_versions
    ADD COLUMN plan_id uuid REFERENCES processing_plans(id),
    ADD COLUMN plan_version integer,
    ADD COLUMN plan_snapshot_json jsonb;

ALTER TABLE processing_task_versions
    ADD CONSTRAINT processing_task_plan_version_fk
    FOREIGN KEY (plan_id, plan_version) REFERENCES processing_plan_versions(plan_id, version);

CREATE INDEX processing_plans_status_idx ON processing_plans(status, updated_at DESC);
