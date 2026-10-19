ALTER TABLE public.device_config_snapshots
    DROP CONSTRAINT device_config_snapshots_adapter_code_check;

ALTER TABLE public.device_config_snapshots
    ADD CONSTRAINT device_config_snapshots_adapter_code_check
    CHECK (adapter_code IN ('thcpn_legacy_mysql', 'carbon_sink_mysql'));
