CREATE TABLE public.workspace_api_keys (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
    name text NOT NULL,
    key_prefix text NOT NULL,
    secret_hash text NOT NULL UNIQUE,
    created_by uuid NOT NULL REFERENCES public.users(id),
    expires_at timestamptz,
    last_used_at timestamptz,
    revoked_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CHECK (length(name) BETWEEN 1 AND 100)
);
CREATE INDEX workspace_api_keys_workspace_created_idx ON public.workspace_api_keys(workspace_id, created_at DESC);

