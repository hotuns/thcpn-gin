ALTER TABLE public.export_jobs DROP COLUMN IF EXISTS file_size_bytes;
DROP TABLE IF EXISTS public.workspace_download_usage;
DROP TABLE IF EXISTS public.workspace_traffic_pack_grants;
DROP TABLE IF EXISTS public.workspace_plan_grants;
DROP TABLE IF EXISTS public.workspace_billing_accounts;

