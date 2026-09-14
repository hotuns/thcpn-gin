ALTER TABLE public.data_sources
    DROP CONSTRAINT IF EXISTS data_sources_source_family_check;

ALTER TABLE public.data_sources
    DROP COLUMN IF EXISTS source_family;
