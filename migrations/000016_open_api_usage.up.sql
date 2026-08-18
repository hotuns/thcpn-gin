CREATE TABLE public.workspace_api_usage_daily (
    api_key_id uuid NOT NULL REFERENCES public.workspace_api_keys(id) ON DELETE CASCADE,
    usage_date date NOT NULL,
    request_count bigint NOT NULL DEFAULT 0 CHECK (request_count >= 0),
    last_used_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (api_key_id, usage_date)
);
