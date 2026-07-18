DROP TABLE IF EXISTS workspace_admin_interventions;

DROP INDEX IF EXISTS audit_logs_admin_created_idx;

ALTER TABLE audit_logs
    DROP CONSTRAINT audit_logs_actor_type_check,
    DROP COLUMN actor_admin_id,
    ADD CONSTRAINT audit_logs_actor_type_check
        CHECK (actor_type IN ('user', 'service_account', 'system', 'anonymous'));
