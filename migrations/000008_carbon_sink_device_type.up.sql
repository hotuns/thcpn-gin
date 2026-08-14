-- Carbon sink v2 device type and source adapter support.

ALTER TABLE public.devices
    DROP CONSTRAINT IF EXISTS devices_device_type_check;

ALTER TABLE public.devices
    ADD CONSTRAINT devices_device_type_check
    CHECK (device_type = ANY (ARRAY['standalone'::text, 'gateway'::text, 'gateway_node'::text, 'camera'::text, 'carbon_sink'::text]));

ALTER TABLE public.device_source_refs
    DROP CONSTRAINT IF EXISTS device_source_refs_adapter_code_check;

ALTER TABLE public.device_source_refs
    ADD CONSTRAINT device_source_refs_adapter_code_check
    CHECK (adapter_code = ANY (ARRAY['thcpn_legacy_mysql'::text, 'thcpn_legacy_camera'::text, 'carbon_sink_mysql'::text]));

COMMENT ON COLUMN public.devices.device_type IS '平台设备类型，例如 gateway、gateway_node、camera、carbon_sink 或 standalone。';
