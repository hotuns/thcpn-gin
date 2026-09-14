ALTER TABLE public.data_stream_bindings
    DROP CONSTRAINT data_stream_bindings_adapter_code_check;

ALTER TABLE public.data_stream_bindings
    ADD CONSTRAINT data_stream_bindings_adapter_code_check
    CHECK (adapter_code = ANY (ARRAY['generic_columns'::text, 'generic_media'::text, 'http_api'::text, 'thcpn_legacy_mysql'::text]));
