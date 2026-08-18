CREATE TABLE public.user_notifications (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    workspace_id uuid REFERENCES public.workspaces(id) ON DELETE CASCADE,
    category text NOT NULL DEFAULT 'system' CHECK (category IN ('system','billing','device','export','security')),
    level text NOT NULL DEFAULT 'info' CHECK (level IN ('info','success','warning','error')),
    title text NOT NULL,
    content text NOT NULL,
    action_url text,
    read_at timestamptz,
    expires_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX user_notifications_user_created_idx ON public.user_notifications(user_id, created_at DESC);
CREATE INDEX user_notifications_user_unread_idx ON public.user_notifications(user_id, created_at DESC) WHERE read_at IS NULL;

CREATE TABLE public.system_announcements (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    title text NOT NULL,
    content text NOT NULL,
    level text NOT NULL DEFAULT 'info' CHECK (level IN ('info','success','warning','error')),
    audience_type text NOT NULL DEFAULT 'all' CHECK (audience_type IN ('all','workspace')),
    workspace_id uuid REFERENCES public.workspaces(id) ON DELETE CASCADE,
    status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','archived')),
    published_at timestamptz,
    expires_at timestamptz,
    created_by uuid NOT NULL REFERENCES public.system_admins(id),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CHECK ((audience_type = 'all' AND workspace_id IS NULL) OR (audience_type = 'workspace' AND workspace_id IS NOT NULL))
);
CREATE INDEX system_announcements_active_idx ON public.system_announcements(status, published_at DESC);

CREATE TABLE public.announcement_reads (
    announcement_id uuid NOT NULL REFERENCES public.system_announcements(id) ON DELETE CASCADE,
    user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    read_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (announcement_id, user_id)
);
