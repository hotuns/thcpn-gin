CREATE TABLE public.workspace_billing_accounts (
    workspace_id uuid PRIMARY KEY REFERENCES public.workspaces(id) ON DELETE CASCADE,
    professional_started_at timestamptz,
    professional_expires_at timestamptz,
    monthly_download_limit_bytes bigint NOT NULL DEFAULT 107374182400 CHECK (monthly_download_limit_bytes >= 0),
    traffic_pack_balance_bytes bigint NOT NULL DEFAULT 0 CHECK (traffic_pack_balance_bytes >= 0),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.workspace_plan_grants (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
    source_type text NOT NULL CHECK (source_type IN ('device_order', 'service_contract', 'manual_correction')),
    reference_no text,
    amount_cents bigint NOT NULL DEFAULT 0 CHECK (amount_cents >= 0),
    starts_at timestamptz NOT NULL,
    ends_at timestamptz NOT NULL CHECK (ends_at > starts_at),
    reason text NOT NULL,
    actor_admin_id uuid NOT NULL REFERENCES public.system_admins(id),
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX workspace_plan_grants_workspace_created_idx ON public.workspace_plan_grants(workspace_id, created_at DESC);

CREATE TABLE public.workspace_traffic_pack_grants (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
    bytes bigint NOT NULL CHECK (bytes > 0),
    price_cents bigint NOT NULL DEFAULT 0 CHECK (price_cents >= 0),
    reference_no text,
    reason text NOT NULL,
    actor_admin_id uuid NOT NULL REFERENCES public.system_admins(id),
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX workspace_traffic_pack_grants_workspace_created_idx ON public.workspace_traffic_pack_grants(workspace_id, created_at DESC);

CREATE TABLE public.workspace_download_usage (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
    usage_month date NOT NULL,
    source_type text NOT NULL CHECK (source_type IN ('media', 'export', 'processing', 'api_file')),
    resource_id uuid,
    object_key text NOT NULL,
    bytes bigint NOT NULL CHECK (bytes > 0),
    monthly_bytes bigint NOT NULL DEFAULT 0 CHECK (monthly_bytes >= 0),
    traffic_pack_bytes bigint NOT NULL DEFAULT 0 CHECK (traffic_pack_bytes >= 0),
    actor_user_id uuid REFERENCES public.users(id),
    idempotency_key text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (workspace_id, idempotency_key)
);
CREATE INDEX workspace_download_usage_workspace_month_idx ON public.workspace_download_usage(workspace_id, usage_month, created_at DESC);

ALTER TABLE public.export_jobs ADD COLUMN file_size_bytes bigint CHECK (file_size_bytes IS NULL OR file_size_bytes >= 0);

