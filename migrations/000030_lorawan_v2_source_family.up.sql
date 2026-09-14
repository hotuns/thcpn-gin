ALTER TABLE public.data_sources
    DROP CONSTRAINT data_sources_source_family_check;

ALTER TABLE public.data_sources
    ADD CONSTRAINT data_sources_source_family_check
    CHECK (source_family IS NULL OR source_family = ANY (ARRAY['thcpn'::text, 'carbon'::text, 'lorawan_v2'::text]));
