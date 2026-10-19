-- Refuse rollback while carbon snapshots exist; do not discard synced data.
ALTER TABLE public.device_config_snapshots
    DROP CONSTRAINT device_config_snapshots_adapter_code_check;

ALTER TABLE public.device_config_snapshots
    ADD CONSTRAINT device_config_snapshots_adapter_code_check
    CHECK (adapter_code = 'thcpn_legacy_mysql');
