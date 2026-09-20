CREATE TABLE public.alert_rules (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
    name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 120),
    type text NOT NULL CHECK (type IN ('telemetry_threshold','device_offline')),
    severity text NOT NULL CHECK (severity IN ('warning','critical')),
    device_id uuid NOT NULL REFERENCES public.devices(id) ON DELETE CASCADE,
    data_stream_id uuid REFERENCES public.data_streams(id) ON DELETE CASCADE,
    condition_mode text CHECK (condition_mode IN ('above','below','outside')),
    lower_value double precision,
    upper_value double precision,
    duration_seconds integer NOT NULL DEFAULT 300 CHECK (duration_seconds BETWEEN 0 AND 2592000),
    recovery_delta double precision NOT NULL DEFAULT 0 CHECK (recovery_delta >= 0),
    offline_after_seconds integer CHECK (offline_after_seconds BETWEEN 60 AND 2592000),
    channels text[] NOT NULL DEFAULT ARRAY['in_app']::text[],
    enabled boolean NOT NULL DEFAULT true,
    archived_at timestamptz,
    created_by uuid NOT NULL REFERENCES public.users(id),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CHECK (
      (type='telemetry_threshold' AND data_stream_id IS NOT NULL AND condition_mode IS NOT NULL AND offline_after_seconds IS NULL)
      OR (type='device_offline' AND data_stream_id IS NULL AND condition_mode IS NULL AND lower_value IS NULL AND upper_value IS NULL AND offline_after_seconds IS NOT NULL)
    ),
    CHECK (
      type='device_offline'
      OR (condition_mode='above' AND upper_value IS NOT NULL AND lower_value IS NULL)
      OR (condition_mode='below' AND lower_value IS NOT NULL AND upper_value IS NULL)
      OR (condition_mode='outside' AND lower_value IS NOT NULL AND upper_value IS NOT NULL AND lower_value < upper_value)
    ),
    CHECK (channels <@ ARRAY['in_app','email']::text[] AND cardinality(channels) > 0)
);
CREATE INDEX alert_rules_workspace_idx ON public.alert_rules(workspace_id, archived_at, enabled);
CREATE INDEX alert_rules_device_idx ON public.alert_rules(device_id, archived_at);

CREATE TABLE public.alert_rule_recipients (
    rule_id uuid NOT NULL REFERENCES public.alert_rules(id) ON DELETE CASCADE,
    user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    PRIMARY KEY (rule_id, user_id)
);

CREATE TABLE public.alert_evaluation_states (
    rule_id uuid PRIMARY KEY REFERENCES public.alert_rules(id) ON DELETE CASCADE,
    state text NOT NULL DEFAULT 'normal' CHECK (state IN ('normal','pending','firing')),
    pending_since timestamptz,
    last_evaluated_at timestamptz,
    last_observed_at timestamptz,
    last_value double precision,
    last_error text,
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.alert_events (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    rule_id uuid NOT NULL REFERENCES public.alert_rules(id),
    workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
    device_id uuid NOT NULL REFERENCES public.devices(id) ON DELETE CASCADE,
    data_stream_id uuid REFERENCES public.data_streams(id) ON DELETE SET NULL,
    severity text NOT NULL CHECK (severity IN ('warning','critical')),
    title text NOT NULL,
    content text NOT NULL,
    trigger_value double precision,
    trigger_observed_at timestamptz,
    rule_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
    triggered_at timestamptz NOT NULL DEFAULT now(),
    resolved_at timestamptz,
    resolved_value double precision,
    acknowledged_at timestamptz,
    acknowledged_by uuid REFERENCES public.users(id),
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX alert_events_one_open_per_rule_idx ON public.alert_events(rule_id) WHERE resolved_at IS NULL;
CREATE INDEX alert_events_workspace_idx ON public.alert_events(workspace_id, triggered_at DESC);

CREATE TABLE public.alert_deliveries (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id uuid NOT NULL REFERENCES public.alert_events(id) ON DELETE CASCADE,
    user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    channel text NOT NULL CHECK (channel IN ('in_app','email')),
    kind text NOT NULL CHECK (kind IN ('triggered','resolved')),
    status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sent','failed','skipped')),
    attempts integer NOT NULL DEFAULT 0,
    next_attempt_at timestamptz NOT NULL DEFAULT now(),
    sent_at timestamptz,
    last_error text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (event_id, user_id, channel, kind)
);
CREATE INDEX alert_deliveries_pending_idx ON public.alert_deliveries(next_attempt_at) WHERE status IN ('pending','failed') AND attempts < 5;
