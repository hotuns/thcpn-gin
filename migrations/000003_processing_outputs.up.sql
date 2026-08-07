CREATE TABLE processing_task_outputs (
    task_id uuid NOT NULL,
    task_version integer NOT NULL,
    output_code varchar(64) NOT NULL,
    name varchar(128) NOT NULL,
    kind varchar(16) NOT NULL CHECK (kind IN ('metric', 'record', 'artifact')),
    unit varchar(32),
    content_type varchar(128),
    definition_json jsonb NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (task_id, task_version, output_code),
    FOREIGN KEY (task_id, task_version) REFERENCES processing_task_versions(task_id, version) ON DELETE CASCADE
);
