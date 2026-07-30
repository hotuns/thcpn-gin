-- THCPN Platform baseline schema.

-- Generated from the verified PostgreSQL schema; contains no business or demo data.

--
-- PostgreSQL database dump
--


-- Dumped from database version 16.14
-- Dumped by pg_dump version 16.14

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: pgcrypto; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA public;


--
-- Name: EXTENSION pgcrypto; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION pgcrypto IS 'cryptographic functions';


--
-- Name: block_workspace_delete_with_devices(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.block_workspace_delete_with_devices() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM device_assignments da
        WHERE da.workspace_id = OLD.id AND da.status = 'active'
    ) THEN
        RAISE EXCEPTION 'workspace has assigned devices';
    END IF;
    RETURN OLD;
END;
$$;


--
-- Name: reject_gateway_node_assignment(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.reject_gateway_node_assignment() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    IF NEW.status = 'active' AND EXISTS (
        SELECT 1 FROM devices d
        WHERE d.id = NEW.device_id AND d.device_type = 'gateway_node'
    ) THEN
        RAISE EXCEPTION 'gateway node inherits assignment from its gateway';
    END IF;
    RETURN NEW;
END;
$$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: access_grant_permissions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.access_grant_permissions (
    access_grant_id uuid NOT NULL,
    permission_id uuid NOT NULL
);


--
-- Name: TABLE access_grant_permissions; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.access_grant_permissions IS '单条资源授权对应的显式权限集合。';


--
-- Name: access_grants; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.access_grants (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    subject_type text DEFAULT 'user'::text NOT NULL,
    subject_id uuid NOT NULL,
    role_id uuid NOT NULL,
    scope_type text NOT NULL,
    scope_id uuid NOT NULL,
    expires_at timestamptz,
    allow_reshare boolean DEFAULT false NOT NULL,
    allow_api_access boolean DEFAULT false NOT NULL,
    created_by uuid NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    created_at timestamptz DEFAULT now() NOT NULL,
    updated_at timestamptz DEFAULT now() NOT NULL,
    template_code text NOT NULL,
    parent_grant_id uuid,
    CONSTRAINT access_grants_check CHECK (((expires_at IS NULL) OR (expires_at > created_at))),
    CONSTRAINT access_grants_scope_type_check CHECK ((scope_type = ANY (ARRAY['workspace'::text, 'project'::text, 'site'::text, 'device'::text, 'dataset'::text]))),
    CONSTRAINT access_grants_status_check CHECK ((status = ANY (ARRAY['active'::text, 'revoked'::text, 'expired'::text]))),
    CONSTRAINT access_grants_subject_type_check CHECK ((subject_type = 'user'::text))
);


--
-- Name: TABLE access_grants; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.access_grants IS '用户在工作区资源上的授权记录，支持作用域、期限、转授权和委派链。';


--
-- Name: audit_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.audit_logs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid,
    actor_type text NOT NULL,
    actor_id uuid,
    action text NOT NULL,
    resource_type text NOT NULL,
    resource_id uuid,
    result text NOT NULL,
    reason text,
    ip text,
    user_agent text,
    request_id text,
    created_at timestamptz DEFAULT now() NOT NULL,
    actor_admin_id uuid,
    CONSTRAINT audit_logs_actor_type_check CHECK ((actor_type = ANY (ARRAY['user'::text, 'system_admin'::text, 'service_account'::text, 'system'::text, 'anonymous'::text]))),
    CONSTRAINT audit_logs_result_check CHECK ((result = ANY (ARRAY['success'::text, 'failure'::text])))
);


--
-- Name: TABLE audit_logs; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.audit_logs IS '统一不可变操作日志，记录普通用户或系统管理员的动作、资源、结果和 request ID。';


--
-- Name: COLUMN audit_logs.request_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.audit_logs.request_id IS '关联 HTTP 请求和服务日志的 request ID。';


--
-- Name: auth_access_token_blacklist; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.auth_access_token_blacklist (
    token_hash text NOT NULL,
    user_id uuid NOT NULL,
    expires_at timestamptz NOT NULL,
    revoked_at timestamptz DEFAULT now() NOT NULL,
    created_at timestamptz DEFAULT now() NOT NULL
);


--
-- Name: TABLE auth_access_token_blacklist; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.auth_access_token_blacklist IS '已主动撤销但尚未自然过期的普通用户访问令牌哈希。';


--
-- Name: auth_password_change_sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.auth_password_change_sessions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    token_hash text NOT NULL,
    expires_at timestamptz NOT NULL,
    used_at timestamptz,
    created_at timestamptz DEFAULT now() NOT NULL,
    CONSTRAINT auth_password_change_sessions_check CHECK ((expires_at > created_at))
);


--
-- Name: TABLE auth_password_change_sessions; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.auth_password_change_sessions IS '找回或修改密码使用的一次性短期会话。';


--
-- Name: auth_refresh_sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.auth_refresh_sessions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    refresh_token_hash text NOT NULL,
    user_agent text,
    client_ip text,
    expires_at timestamptz NOT NULL,
    last_used_at timestamptz,
    revoked_at timestamptz,
    created_at timestamptz DEFAULT now() NOT NULL,
    updated_at timestamptz DEFAULT now() NOT NULL,
    CONSTRAINT auth_refresh_sessions_check CHECK ((expires_at > created_at))
);


--
-- Name: TABLE auth_refresh_sessions; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.auth_refresh_sessions IS '普通用户刷新令牌会话，用于多端登录、续期和单会话撤销。';


--
-- Name: camera_bindings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.camera_bindings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    device_id uuid NOT NULL,
    provider text DEFAULT 'ezviz'::text NOT NULL,
    device_serial text NOT NULL,
    channel_no integer DEFAULT 1 NOT NULL,
    default_quality text DEFAULT 'hd'::text NOT NULL,
    is_encrypted boolean DEFAULT false NOT NULL,
    validate_code_secret_ref text,
    status text DEFAULT 'active'::text NOT NULL,
    created_at timestamptz DEFAULT now() NOT NULL,
    updated_at timestamptz DEFAULT now() NOT NULL,
    CONSTRAINT camera_bindings_channel_no_check CHECK ((channel_no > 0)),
    CONSTRAINT camera_bindings_default_quality_check CHECK ((default_quality = ANY (ARRAY['fluent'::text, 'standard'::text, 'hd'::text, 'ultra_hd'::text]))),
    CONSTRAINT camera_bindings_provider_check CHECK ((provider = 'ezviz'::text)),
    CONSTRAINT camera_bindings_status_check CHECK ((status = ANY (ARRAY['active'::text, 'disabled'::text])))
);


--
-- Name: TABLE camera_bindings; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.camera_bindings IS '相机设备与第三方视频服务的绑定，不保存供应商应用密钥正文。';


--
-- Name: computed_data_streams; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.computed_data_streams (
    data_stream_id uuid NOT NULL,
    formula text NOT NULL,
    created_by uuid NOT NULL,
    updated_by uuid NOT NULL,
    created_at timestamptz DEFAULT now() NOT NULL,
    updated_at timestamptz DEFAULT now() NOT NULL,
    CONSTRAINT computed_data_streams_formula_check CHECK (((length(formula) >= 1) AND (length(formula) <= 1024)))
);


--
-- Name: TABLE computed_data_streams; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.computed_data_streams IS '查询时计算的数据流公式定义。设备和启用状态来自 data_streams，公式依赖在读取时解析，计算结果不持久化。';


--
-- Name: COLUMN computed_data_streams.formula; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.computed_data_streams.formula IS '安全公式，可引用 stream.<code> 和 meta.<key>。';


--
-- Name: data_sources; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.data_sources (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    type text NOT NULL,
    dsn_secret_ref text NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    created_by uuid NOT NULL,
    created_at timestamptz DEFAULT now() NOT NULL,
    updated_at timestamptz DEFAULT now() NOT NULL,
    CONSTRAINT data_sources_status_check CHECK ((status = ANY (ARRAY['active'::text, 'disabled'::text, 'archived'::text]))),
    CONSTRAINT data_sources_type_check CHECK ((type = ANY (ARRAY['postgres'::text, 'mysql'::text, 'clickhouse'::text, 'http_api'::text, 'file'::text])))
);


--
-- Name: TABLE data_sources; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.data_sources IS '管理员维护的外部数据源实例，只保存 DSN 密钥引用，不保存明文连接密钥。';


--
-- Name: COLUMN data_sources.dsn_secret_ref; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.data_sources.dsn_secret_ref IS '外部 DSN 的环境变量或密钥系统引用，不是明文 DSN。';


--
-- Name: data_stream_bindings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.data_stream_bindings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    data_stream_id uuid NOT NULL,
    data_source_id uuid NOT NULL,
    database_name text,
    schema_name text,
    table_name text,
    device_key_field text,
    device_key_value text,
    time_field text,
    value_field text,
    payload_type text NOT NULL,
    adapter_config_json jsonb DEFAULT '{}'::jsonb NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    created_by uuid NOT NULL,
    created_at timestamptz DEFAULT now() NOT NULL,
    updated_at timestamptz DEFAULT now() NOT NULL,
    adapter_code text NOT NULL,
    created_by_type text DEFAULT 'user'::text NOT NULL,
    CONSTRAINT data_stream_bindings_adapter_code_check CHECK ((adapter_code = ANY (ARRAY['generic_columns'::text, 'generic_media'::text, 'http_api'::text, 'thcpn_legacy_mysql'::text]))),
    CONSTRAINT data_stream_bindings_created_by_type_check CHECK ((created_by_type = ANY (ARRAY['user'::text, 'system_admin'::text, 'system'::text]))),
    CONSTRAINT data_stream_bindings_payload_type_check CHECK ((payload_type = ANY (ARRAY['columns'::text, 'json'::text, 'media'::text]))),
    CONSTRAINT data_stream_bindings_status_check CHECK ((status = ANY (ARRAY['active'::text, 'disabled'::text, 'archived'::text])))
);


--
-- Name: TABLE data_stream_bindings; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.data_stream_bindings IS '原始数据流到外部数据源的读取规则和适配器配置；计算数据流没有源绑定。';


--
-- Name: COLUMN data_stream_bindings.adapter_config_json; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.data_stream_bindings.adapter_config_json IS '适配器专用读取配置，不存储遥测结果。';


--
-- Name: COLUMN data_stream_bindings.created_by; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.data_stream_bindings.created_by IS 'Audit actor identifier; interpret together with created_by_type. This is not resource ownership.';


--
-- Name: data_streams; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.data_streams (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    device_id uuid NOT NULL,
    code text NOT NULL,
    name text NOT NULL,
    type text NOT NULL,
    unit text,
    status text DEFAULT 'active'::text NOT NULL,
    created_by uuid NOT NULL,
    created_at timestamptz DEFAULT now() NOT NULL,
    updated_at timestamptz DEFAULT now() NOT NULL,
    created_by_type text DEFAULT 'user'::text NOT NULL,
    CONSTRAINT data_streams_created_by_type_check CHECK ((created_by_type = ANY (ARRAY['user'::text, 'system_admin'::text, 'system'::text]))),
    CONSTRAINT data_streams_status_check CHECK ((status = ANY (ARRAY['active'::text, 'disabled'::text, 'archived'::text]))),
    CONSTRAINT data_streams_type_check CHECK ((type = ANY (ARRAY['telemetry'::text, 'image'::text, 'video'::text, 'audio'::text, 'event'::text, 'log'::text])))
);


--
-- Name: TABLE data_streams; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.data_streams IS '设备数据通道目录，包括源库原始通道和查询时计算通道。';


--
-- Name: COLUMN data_streams.code; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.data_streams.code IS '设备内稳定的数据指标或图片通道 code。';


--
-- Name: COLUMN data_streams.created_by; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.data_streams.created_by IS 'Audit actor identifier; interpret together with created_by_type. This is not resource ownership.';


--
-- Name: COLUMN data_streams.created_by_type; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.data_streams.created_by_type IS '创建主体类型，区分用户创建和系统同步。';


--
-- Name: dataset_sources; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.dataset_sources (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    dataset_id uuid NOT NULL,
    source_type text NOT NULL,
    source_id uuid NOT NULL,
    created_at timestamptz DEFAULT now() NOT NULL,
    CONSTRAINT dataset_sources_source_type_check CHECK ((source_type = ANY (ARRAY['device'::text, 'data_stream'::text, 'file'::text])))
);


--
-- Name: TABLE dataset_sources; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.dataset_sources IS '数据集包含的设备、数据流或文件来源。';


--
-- Name: datasets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.datasets (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    project_id uuid,
    name text NOT NULL,
    description text,
    data_type text NOT NULL,
    time_start timestamptz NOT NULL,
    time_end timestamptz NOT NULL,
    status text DEFAULT 'draft'::text NOT NULL,
    created_by uuid NOT NULL,
    created_at timestamptz DEFAULT now() NOT NULL,
    updated_at timestamptz DEFAULT now() NOT NULL,
    CONSTRAINT datasets_check CHECK ((time_end > time_start)),
    CONSTRAINT datasets_data_type_check CHECK ((data_type = ANY (ARRAY['telemetry'::text, 'image'::text, 'video'::text, 'audio'::text, 'event'::text, 'log'::text, 'mixed'::text]))),
    CONSTRAINT datasets_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'locked'::text, 'archived'::text, 'published'::text])))
);


--
-- Name: TABLE datasets; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.datasets IS '工作区内可复用的数据分析定义，保存来源和时间范围，不复制原始遥测数据。';


--
-- Name: device_assignments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.device_assignments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    device_id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    project_id uuid,
    site_id uuid,
    status text DEFAULT 'active'::text NOT NULL,
    assigned_by uuid,
    assigned_at timestamptz DEFAULT now() NOT NULL,
    unassigned_at timestamptz,
    created_at timestamptz DEFAULT now() NOT NULL,
    updated_at timestamptz DEFAULT now() NOT NULL,
    assigned_by_type text DEFAULT 'user'::text NOT NULL,
    CONSTRAINT device_assignments_assigned_by_type_check CHECK ((assigned_by_type = ANY (ARRAY['user'::text, 'system_admin'::text, 'system'::text]))),
    CONSTRAINT device_assignments_check CHECK (((site_id IS NULL) OR (project_id IS NOT NULL))),
    CONSTRAINT device_assignments_status_check CHECK ((status = ANY (ARRAY['active'::text, 'transferred'::text, 'removed'::text])))
);


--
-- Name: TABLE device_assignments; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.device_assignments IS '物理设备到工作区、项目和站点的当前或历史分配记录；同一设备仅允许一条有效分配。';


--
-- Name: COLUMN device_assignments.assigned_by; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.device_assignments.assigned_by IS 'Audit actor identifier; interpret together with assigned_by_type.';


--
-- Name: device_capabilities; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.device_capabilities (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    device_id uuid NOT NULL,
    capability_code text NOT NULL,
    created_at timestamptz DEFAULT now() NOT NULL
);


--
-- Name: TABLE device_capabilities; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.device_capabilities IS '设备与能力字典的多对多关系。';


--
-- Name: device_capability_definitions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.device_capability_definitions (
    code text NOT NULL,
    name text NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    sort_order integer DEFAULT 1000 NOT NULL,
    created_at timestamptz DEFAULT now() NOT NULL,
    updated_at timestamptz DEFAULT now() NOT NULL,
    CONSTRAINT device_capability_definitions_code_check CHECK ((code ~ '^[a-z][a-z0-9_]{0,63}$'::text)),
    CONSTRAINT device_capability_definitions_name_check CHECK ((btrim(name) <> ''::text)),
    CONSTRAINT device_capability_definitions_status_check CHECK ((status = ANY (ARRAY['active'::text, 'disabled'::text])))
);


--
-- Name: TABLE device_capability_definitions; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.device_capability_definitions IS '平台支持的设备能力字典。';


--
-- Name: device_claim_credentials; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.device_claim_credentials (
    device_id uuid NOT NULL,
    claim_slug_hash text NOT NULL,
    claim_slug_ciphertext bytea NOT NULL,
    claim_slug_nonce bytea NOT NULL,
    manual_code_hash text NOT NULL,
    manual_code_ciphertext bytea NOT NULL,
    manual_code_nonce bytea NOT NULL,
    printed_at timestamptz,
    created_at timestamptz DEFAULT now() NOT NULL,
    updated_at timestamptz DEFAULT now() NOT NULL
);


--
-- Name: TABLE device_claim_credentials; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.device_claim_credentials IS '设备永久铭牌和手工认领码凭据，匹配值保存哈希，可打印值加密保存。';


--
-- Name: COLUMN device_claim_credentials.claim_slug_hash; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.device_claim_credentials.claim_slug_hash IS '永久二维码认领 token 的哈希，用于安全匹配。';


--
-- Name: COLUMN device_claim_credentials.claim_slug_ciphertext; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.device_claim_credentials.claim_slug_ciphertext IS '永久二维码认领 token 的密文，用于管理员再次打印铭牌。';


--
-- Name: device_claim_requests; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.device_claim_requests (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    idempotency_key text NOT NULL,
    device_id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    assignment_id uuid NOT NULL,
    created_at timestamptz DEFAULT now() NOT NULL
);


--
-- Name: TABLE device_claim_requests; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.device_claim_requests IS '成功设备认领的幂等记录，关联操作者、设备、工作区和最终分配。';


--
-- Name: device_config_snapshots; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.device_config_snapshots (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    device_id uuid NOT NULL,
    data_source_id uuid NOT NULL,
    adapter_code text NOT NULL,
    external_device_id bigint NOT NULL,
    external_config_id bigint NOT NULL,
    version text,
    data_json jsonb DEFAULT '[]'::jsonb NOT NULL,
    image_json jsonb DEFAULT '[]'::jsonb NOT NULL,
    control_json jsonb DEFAULT '{}'::jsonb NOT NULL,
    source_created_at timestamptz,
    source_updated_at timestamptz,
    synced_at timestamptz DEFAULT now() NOT NULL,
    created_at timestamptz DEFAULT now() NOT NULL,
    CONSTRAINT device_config_snapshots_adapter_code_check CHECK ((adapter_code = 'thcpn_legacy_mysql'::text)),
    CONSTRAINT device_config_snapshots_external_config_id_check CHECK ((external_config_id > 0)),
    CONSTRAINT device_config_snapshots_external_device_id_check CHECK ((external_device_id > 0))
);


--
-- Name: TABLE device_config_snapshots; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.device_config_snapshots IS '从 THCPN 源库同步的设备配置快照，用于配置管理、版本冲突检查和数据通道应用。';


--
-- Name: device_environment_profiles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.device_environment_profiles (
    device_id uuid NOT NULL,
    ecosystem_term_id uuid,
    management_term_id uuid,
    deployment_term_id uuid,
    commissioned_year integer,
    research_tags text[] DEFAULT '{}'::text[] NOT NULL,
    overridden_fields text[] DEFAULT '{}'::text[] NOT NULL,
    updated_by uuid,
    updated_actor_type text DEFAULT 'user'::text NOT NULL,
    created_at timestamptz DEFAULT now() NOT NULL,
    updated_at timestamptz DEFAULT now() NOT NULL,
    CONSTRAINT device_environment_profiles_commissioned_year_check CHECK (((commissioned_year IS NULL) OR ((commissioned_year >= 1900) AND (commissioned_year <= 2200)))),
    CONSTRAINT device_environment_profiles_overridden_fields_check CHECK ((overridden_fields <@ ARRAY['ecosystem'::text, 'observation_objects'::text, 'purposes'::text, 'management'::text, 'deployment'::text, 'commissioned_year'::text, 'research_tags'::text])),
    CONSTRAINT device_environment_profiles_updated_actor_type_check CHECK ((updated_actor_type = ANY (ARRAY['user'::text, 'system_admin'::text])))
);


--
-- Name: TABLE device_environment_profiles; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.device_environment_profiles IS '设备级环境分类覆盖和业务标签，不保存源库实时海拔。';


--
-- Name: device_environment_terms; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.device_environment_terms (
    device_id uuid NOT NULL,
    term_id uuid NOT NULL
);


--
-- Name: TABLE device_environment_terms; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.device_environment_terms IS '设备与多值环境分类词条的关系。';


--
-- Name: device_lifecycle_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.device_lifecycle_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    device_id uuid NOT NULL,
    from_status text,
    to_status text NOT NULL,
    occurred_at timestamptz DEFAULT now() NOT NULL,
    note text,
    actor_user_id uuid,
    created_at timestamptz DEFAULT now() NOT NULL,
    CONSTRAINT device_lifecycle_events_from_status_check CHECK ((from_status = ANY (ARRAY['inbound'::text, 'installed'::text, 'online'::text, 'maintenance'::text, 'repairing'::text, 'retired'::text]))),
    CONSTRAINT device_lifecycle_events_to_status_check CHECK ((to_status = ANY (ARRAY['inbound'::text, 'installed'::text, 'online'::text, 'maintenance'::text, 'repairing'::text, 'retired'::text])))
);


--
-- Name: TABLE device_lifecycle_events; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.device_lifecycle_events IS '设备生命周期状态变更日志。';


--
-- Name: device_metadata; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.device_metadata (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    device_id uuid NOT NULL,
    key text NOT NULL,
    name text NOT NULL,
    value_type text NOT NULL,
    value_json jsonb NOT NULL,
    unit text,
    created_by uuid NOT NULL,
    updated_by uuid NOT NULL,
    created_at timestamptz DEFAULT now() NOT NULL,
    updated_at timestamptz DEFAULT now() NOT NULL,
    CONSTRAINT device_metadata_check CHECK ((((value_type = 'number'::text) AND (jsonb_typeof(value_json) = 'number'::text)) OR ((value_type = 'string'::text) AND (jsonb_typeof(value_json) = 'string'::text)) OR ((value_type = 'boolean'::text) AND (jsonb_typeof(value_json) = 'boolean'::text)))),
    CONSTRAINT device_metadata_key_check CHECK ((key ~ '^[A-Za-z][A-Za-z0-9_]{0,63}$'::text)),
    CONSTRAINT device_metadata_value_type_check CHECK ((value_type = ANY (ARRAY['number'::text, 'string'::text, 'boolean'::text])))
);


--
-- Name: TABLE device_metadata; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.device_metadata IS '物理设备的业务元数据，支持数字、文本和布尔值，可供查询时计算公式引用。';


--
-- Name: COLUMN device_metadata.key; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.device_metadata.key IS '公式引用使用的稳定 key，格式为字母开头的字母数字下划线。';


--
-- Name: COLUMN device_metadata.value_type; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.device_metadata.value_type IS '元数据类型：number、string 或 boolean。';


--
-- Name: COLUMN device_metadata.value_json; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.device_metadata.value_json IS '与 value_type 一致的当前值，不记录历史版本。';


--
-- Name: device_operations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.device_operations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    device_id uuid NOT NULL,
    operation_type text NOT NULL,
    status text DEFAULT 'requested'::text NOT NULL,
    request_json jsonb DEFAULT '{}'::jsonb NOT NULL,
    requested_by uuid NOT NULL,
    created_at timestamptz DEFAULT now() NOT NULL,
    updated_at timestamptz DEFAULT now() NOT NULL,
    CONSTRAINT device_operations_operation_type_check CHECK ((operation_type = ANY (ARRAY['calibration'::text, 'firmware_upgrade'::text]))),
    CONSTRAINT device_operations_status_check CHECK ((status = ANY (ARRAY['requested'::text, 'running'::text, 'success'::text, 'failed'::text, 'cancelled'::text])))
);


--
-- Name: TABLE device_operations; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.device_operations IS '用户发起的设备配置或控制操作任务及其执行状态。';


--
-- Name: device_profile_images; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.device_profile_images (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    device_id uuid NOT NULL,
    object_key text NOT NULL,
    original_filename text NOT NULL,
    content_type text NOT NULL,
    size_bytes bigint NOT NULL,
    width integer,
    height integer,
    caption text,
    sort_order integer DEFAULT 0 NOT NULL,
    is_cover boolean DEFAULT false NOT NULL,
    uploaded_by uuid NOT NULL,
    created_at timestamptz DEFAULT now() NOT NULL,
    updated_at timestamptz DEFAULT now() NOT NULL,
    CONSTRAINT device_profile_images_content_type_check CHECK ((content_type = ANY (ARRAY['image/jpeg'::text, 'image/png'::text, 'image/webp'::text]))),
    CONSTRAINT device_profile_images_height_check CHECK (((height IS NULL) OR (height > 0))),
    CONSTRAINT device_profile_images_size_bytes_check CHECK (((size_bytes > 0) AND (size_bytes <= 10485760))),
    CONSTRAINT device_profile_images_sort_order_check CHECK ((sort_order >= 0)),
    CONSTRAINT device_profile_images_width_check CHECK (((width IS NULL) OR (width > 0)))
);


--
-- Name: TABLE device_profile_images; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.device_profile_images IS '设备资料图片元数据，图片二进制存储在对象存储。';


--
-- Name: device_profiles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.device_profiles (
    device_id uuid NOT NULL,
    description text,
    location_text text,
    updated_by uuid,
    created_at timestamptz DEFAULT now() NOT NULL,
    updated_at timestamptz DEFAULT now() NOT NULL
);


--
-- Name: TABLE device_profiles; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.device_profiles IS '平台维护的设备业务资料，目前保存描述和文字地址，不保存实时经纬度。';


--
-- Name: device_publications; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.device_publications (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    device_id uuid NOT NULL,
    public_slug text NOT NULL,
    enabled boolean DEFAULT false NOT NULL,
    password_hash text,
    access_version integer DEFAULT 1 NOT NULL,
    created_by uuid NOT NULL,
    updated_by uuid NOT NULL,
    created_at timestamptz DEFAULT now() NOT NULL,
    updated_at timestamptz DEFAULT now() NOT NULL,
    CONSTRAINT device_publications_access_version_check CHECK ((access_version > 0)),
    CONSTRAINT device_publications_public_slug_check CHECK ((length(public_slug) >= 20))
);


--
-- Name: TABLE device_publications; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.device_publications IS '设备永久公开地址、启用状态、密码哈希和公开会话版本。';


--
-- Name: COLUMN device_publications.public_slug; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.device_publications.public_slug IS '首次公开时生成且永久固定的高熵随机地址标识。';


--
-- Name: COLUMN device_publications.access_version; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.device_publications.access_version IS '公开访问会话版本；密码或公开状态变化时递增以使旧会话失效。';


--
-- Name: device_relations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.device_relations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    parent_device_id uuid NOT NULL,
    child_device_id uuid NOT NULL,
    relation_type text NOT NULL,
    data_source_id uuid NOT NULL,
    external_parent_device_id bigint NOT NULL,
    external_child_device_id bigint NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    synced_at timestamptz DEFAULT now() NOT NULL,
    created_at timestamptz DEFAULT now() NOT NULL,
    updated_at timestamptz DEFAULT now() NOT NULL,
    CONSTRAINT device_relations_check CHECK ((parent_device_id <> child_device_id)),
    CONSTRAINT device_relations_external_child_device_id_check CHECK ((external_child_device_id > 0)),
    CONSTRAINT device_relations_external_parent_device_id_check CHECK ((external_parent_device_id > 0)),
    CONSTRAINT device_relations_relation_type_check CHECK ((relation_type = 'gateway_node'::text)),
    CONSTRAINT device_relations_status_check CHECK ((status = ANY (ARRAY['active'::text, 'removed'::text])))
);


--
-- Name: TABLE device_relations; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.device_relations IS '设备父子拓扑关系，主要用于网关和节点以及节点权限继承。';


--
-- Name: device_source_refs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.device_source_refs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    device_id uuid NOT NULL,
    data_source_id uuid NOT NULL,
    adapter_code text NOT NULL,
    external_device_id bigint NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    synced_at timestamptz DEFAULT now() NOT NULL,
    created_at timestamptz DEFAULT now() NOT NULL,
    updated_at timestamptz DEFAULT now() NOT NULL,
    CONSTRAINT device_source_refs_adapter_code_check CHECK ((adapter_code = ANY (ARRAY['thcpn_legacy_mysql'::text, 'thcpn_legacy_camera'::text]))),
    CONSTRAINT device_source_refs_external_device_id_check CHECK ((external_device_id > 0)),
    CONSTRAINT device_source_refs_status_check CHECK ((status = ANY (ARRAY['active'::text, 'disabled'::text, 'archived'::text])))
);


--
-- Name: TABLE device_source_refs; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.device_source_refs IS '平台设备到外部设备的稳定映射，只保存数据源、适配器和外部设备 ID。';


--
-- Name: COLUMN device_source_refs.external_device_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.device_source_refs.external_device_id IS '设备在对应外部数据源中的数值 ID。';


--
-- Name: COLUMN device_source_refs.synced_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.device_source_refs.synced_at IS '最近一次确认该映射或同步设备主记录的时间。';


--
-- Name: device_taxonomy_terms; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.device_taxonomy_terms (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    kind text NOT NULL,
    code text NOT NULL,
    name_zh text NOT NULL,
    name_en text NOT NULL,
    parent_id uuid,
    status text DEFAULT 'active'::text NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    system_defined boolean DEFAULT false NOT NULL,
    created_at timestamptz DEFAULT now() NOT NULL,
    updated_at timestamptz DEFAULT now() NOT NULL,
    CONSTRAINT device_taxonomy_terms_kind_check CHECK ((kind = ANY (ARRAY['ecosystem'::text, 'observation_object'::text, 'purpose'::text, 'management'::text, 'deployment'::text]))),
    CONSTRAINT device_taxonomy_terms_status_check CHECK ((status = ANY (ARRAY['active'::text, 'inactive'::text])))
);


--
-- Name: TABLE device_taxonomy_terms; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.device_taxonomy_terms IS '设备生态环境、观测对象、用途、管理方式和部署方式的中英文分类字典。';


--
-- Name: devices; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.devices (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    product_id text,
    serial_no text NOT NULL,
    name text NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    activated_at timestamptz,
    created_at timestamptz DEFAULT now() NOT NULL,
    updated_at timestamptz DEFAULT now() NOT NULL,
    lifecycle_status text DEFAULT 'inbound'::text NOT NULL,
    lifecycle_updated_at timestamptz,
    device_type text DEFAULT 'standalone'::text NOT NULL,
    CONSTRAINT devices_device_type_check CHECK ((device_type = ANY (ARRAY['standalone'::text, 'gateway'::text, 'gateway_node'::text, 'camera'::text]))),
    CONSTRAINT devices_lifecycle_status_check CHECK ((lifecycle_status = ANY (ARRAY['inbound'::text, 'installed'::text, 'online'::text, 'maintenance'::text, 'repairing'::text, 'retired'::text]))),
    CONSTRAINT devices_status_check CHECK ((status = ANY (ARRAY['active'::text, 'disabled'::text, 'retired'::text])))
);


--
-- Name: TABLE devices; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.devices IS '平台设备主表，只保存稳定身份、类型和业务生命周期，不缓存源库实时运行属性或设备位置。';


--
-- Name: COLUMN devices.serial_no; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.devices.serial_no IS '平台唯一设备序列号。';


--
-- Name: COLUMN devices.lifecycle_status; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.devices.lifecycle_status IS '设备入库、待认领、服役和退役等业务生命周期状态。';


--
-- Name: COLUMN devices.device_type; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.devices.device_type IS '平台设备类型，例如 gateway、node、camera 或 standalone。';


--
-- Name: export_jobs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.export_jobs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    requested_by uuid NOT NULL,
    resource_type text NOT NULL,
    resource_id uuid NOT NULL,
    export_type text NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    file_object_key text,
    error_message text,
    created_at timestamptz DEFAULT now() NOT NULL,
    updated_at timestamptz DEFAULT now() NOT NULL,
    started_at timestamptz,
    finished_at timestamptz,
    expires_at timestamptz NOT NULL,
    request_config_json jsonb DEFAULT '{}'::jsonb NOT NULL,
    CONSTRAINT export_jobs_check CHECK ((((status = 'success'::text) AND (file_object_key IS NOT NULL)) OR (status <> 'success'::text))),
    CONSTRAINT export_jobs_export_type_check CHECK ((export_type = ANY (ARRAY['telemetry_csv'::text, 'telemetry_excel'::text, 'media_zip'::text, 'dataset_zip'::text]))),
    CONSTRAINT export_jobs_request_config_object_check CHECK ((jsonb_typeof(request_config_json) = 'object'::text)),
    CONSTRAINT export_jobs_resource_type_check CHECK ((resource_type = ANY (ARRAY['device'::text, 'data_stream'::text, 'dataset'::text, 'media'::text]))),
    CONSTRAINT export_jobs_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'running'::text, 'success'::text, 'failed'::text, 'expired'::text])))
);


--
-- Name: TABLE export_jobs; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.export_jobs IS '异步数据导出任务及结果对象、状态、错误和下载有效期。';


--
-- Name: invitation_permissions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.invitation_permissions (
    invitation_id uuid NOT NULL,
    permission_id uuid NOT NULL
);


--
-- Name: TABLE invitation_permissions; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.invitation_permissions IS '邀请接受后应授予的显式权限集合。';


--
-- Name: invitations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.invitations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    invitee_email text,
    invitee_phone text,
    role_id uuid NOT NULL,
    scope_type text NOT NULL,
    scope_id uuid NOT NULL,
    expires_at timestamptz,
    invited_by uuid NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    created_at timestamptz DEFAULT now() NOT NULL,
    updated_at timestamptz DEFAULT now() NOT NULL,
    template_code text NOT NULL,
    parent_grant_id uuid,
    CONSTRAINT invitations_check CHECK ((((NULLIF(btrim(invitee_email), ''::text) IS NOT NULL) AND (NULLIF(btrim(invitee_phone), ''::text) IS NULL)) OR ((NULLIF(btrim(invitee_email), ''::text) IS NULL) AND (NULLIF(btrim(invitee_phone), ''::text) IS NOT NULL)))),
    CONSTRAINT invitations_check1 CHECK (((expires_at IS NULL) OR (expires_at > created_at))),
    CONSTRAINT invitations_scope_type_check CHECK ((scope_type = ANY (ARRAY['workspace'::text, 'project'::text, 'site'::text, 'device'::text, 'dataset'::text]))),
    CONSTRAINT invitations_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'accepted'::text, 'expired'::text, 'revoked'::text])))
);


--
-- Name: TABLE invitations; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.invitations IS '待接受的工作区或资源邀请，包含邀请对象、作用域、权限模板和期限。';


--
-- Name: permissions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.permissions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    code text NOT NULL,
    name text NOT NULL,
    resource_type text NOT NULL,
    action text NOT NULL
);


--
-- Name: TABLE permissions; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.permissions IS '稳定权限字典，按资源类型和动作定义权限 code。';


--
-- Name: projects; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.projects (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    name text NOT NULL,
    description text,
    status text DEFAULT 'active'::text NOT NULL,
    created_by uuid NOT NULL,
    created_at timestamptz DEFAULT now() NOT NULL,
    updated_at timestamptz DEFAULT now() NOT NULL,
    CONSTRAINT projects_status_check CHECK ((status = ANY (ARRAY['active'::text, 'archived'::text])))
);


--
-- Name: TABLE projects; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.projects IS '工作区下的项目主数据。';


--
-- Name: role_permissions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.role_permissions (
    role_id uuid NOT NULL,
    permission_id uuid NOT NULL
);


--
-- Name: TABLE role_permissions; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.role_permissions IS '角色与权限的多对多关系。';


--
-- Name: roles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.roles (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid,
    code text NOT NULL,
    name text NOT NULL,
    is_system_role boolean DEFAULT false NOT NULL,
    created_at timestamptz DEFAULT now() NOT NULL,
    updated_at timestamptz DEFAULT now() NOT NULL
);


--
-- Name: TABLE roles; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.roles IS '系统角色和工作区自定义角色定义。';


--
-- Name: site_environment_profiles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.site_environment_profiles (
    site_id uuid NOT NULL,
    ecosystem_term_id uuid,
    management_term_id uuid,
    deployment_term_id uuid,
    altitude_m double precision,
    commissioned_year integer,
    research_tags text[] DEFAULT '{}'::text[] NOT NULL,
    updated_by uuid,
    updated_actor_type text DEFAULT 'user'::text NOT NULL,
    created_at timestamptz DEFAULT now() NOT NULL,
    updated_at timestamptz DEFAULT now() NOT NULL,
    CONSTRAINT site_environment_profiles_commissioned_year_check CHECK (((commissioned_year IS NULL) OR ((commissioned_year >= 1900) AND (commissioned_year <= 2200)))),
    CONSTRAINT site_environment_profiles_updated_actor_type_check CHECK ((updated_actor_type = ANY (ARRAY['user'::text, 'system_admin'::text])))
);


--
-- Name: TABLE site_environment_profiles; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.site_environment_profiles IS '站点级单值环境分类及业务属性，供设备继承。';


--
-- Name: site_environment_terms; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.site_environment_terms (
    site_id uuid NOT NULL,
    term_id uuid NOT NULL
);


--
-- Name: TABLE site_environment_terms; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.site_environment_terms IS '站点与多值环境分类词条的关系。';


--
-- Name: sites; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sites (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    project_id uuid NOT NULL,
    name text NOT NULL,
    description text,
    location_text text,
    latitude double precision,
    longitude double precision,
    status text DEFAULT 'active'::text NOT NULL,
    created_by uuid NOT NULL,
    created_at timestamptz DEFAULT now() NOT NULL,
    updated_at timestamptz DEFAULT now() NOT NULL,
    CONSTRAINT sites_latitude_check CHECK (((latitude IS NULL) OR ((latitude >= ('-90'::integer)::double precision) AND (latitude <= (90)::double precision)))),
    CONSTRAINT sites_longitude_check CHECK (((longitude IS NULL) OR ((longitude >= ('-180'::integer)::double precision) AND (longitude <= (180)::double precision)))),
    CONSTRAINT sites_status_check CHECK ((status = ANY (ARRAY['active'::text, 'archived'::text])))
);


--
-- Name: TABLE sites; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.sites IS '项目下的业务站点；站点经纬度是人工维护的业务位置，可作为设备地图回退位置。';


--
-- Name: COLUMN sites.latitude; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.sites.latitude IS '人工维护的业务站点纬度，不是设备实时上报纬度。';


--
-- Name: COLUMN sites.longitude; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.sites.longitude IS '人工维护的业务站点经度，不是设备实时上报经度。';


--
-- Name: system_admin_refresh_sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.system_admin_refresh_sessions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    admin_id uuid NOT NULL,
    refresh_token_hash text NOT NULL,
    user_agent text,
    client_ip text,
    expires_at timestamptz NOT NULL,
    last_used_at timestamptz,
    revoked_at timestamptz,
    created_at timestamptz DEFAULT now() NOT NULL,
    updated_at timestamptz DEFAULT now() NOT NULL,
    CONSTRAINT system_admin_refresh_sessions_check CHECK ((expires_at > created_at))
);


--
-- Name: TABLE system_admin_refresh_sessions; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.system_admin_refresh_sessions IS '系统管理员刷新令牌会话，与普通用户会话隔离。';


--
-- Name: system_admins; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.system_admins (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    email text NOT NULL,
    password_hash text NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    failed_attempts integer DEFAULT 0 NOT NULL,
    locked_until timestamptz,
    last_login_at timestamptz,
    created_at timestamptz DEFAULT now() NOT NULL,
    updated_at timestamptz DEFAULT now() NOT NULL,
    CONSTRAINT system_admins_status_check CHECK ((status = ANY (ARRAY['active'::text, 'disabled'::text])))
);


--
-- Name: sensor_templates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sensor_templates (
    id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
    sensor_type text NOT NULL,
    description text,
    port text,
    port_num integer DEFAULT 0 NOT NULL,
    driver text,
    port_nums jsonb DEFAULT '[]'::jsonb NOT NULL,
    params jsonb DEFAULT '{}'::jsonb NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    created_by uuid,
    updated_by uuid,
    created_at timestamptz DEFAULT now() NOT NULL,
    updated_at timestamptz DEFAULT now() NOT NULL,
    CONSTRAINT sensor_templates_status_check CHECK ((status = ANY (ARRAY['active'::text, 'disabled'::text])))
);

COMMENT ON TABLE public.sensor_templates IS '平台维护的传感器配置模板库，替代各 THCPN 源库中的 sensors 表；管理员可复用模板生成设备配置，但修改模板不会自动改写已有设备配置。';
COMMENT ON COLUMN public.sensor_templates.sensor_type IS '传感器型号，例如 HCD6818。';
COMMENT ON COLUMN public.sensor_templates.driver IS '通信驱动或协议，例如 modbusrtu。';
COMMENT ON COLUMN public.sensor_templates.port_nums IS '该模板允许选择的端口编号数组。';
COMMENT ON COLUMN public.sensor_templates.params IS '完整协议参数与指标定义，包含 command、wait_time、contents 及厂商扩展字段。';
COMMENT ON COLUMN public.sensor_templates.status IS '模板状态：active 可用于设备配置，disabled 仅保留维护。';

CREATE INDEX sensor_templates_sensor_type_idx ON public.sensor_templates USING btree (sensor_type);
CREATE INDEX sensor_templates_lookup_idx ON public.sensor_templates USING btree (status, port, driver);


--
-- Name: TABLE system_admins; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.system_admins IS '系统管理员独立账号，与普通用户和工作区成员身份隔离。';


--
-- Name: user_credentials; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_credentials (
    user_id uuid NOT NULL,
    password_hash text NOT NULL,
    password_updated_at timestamptz DEFAULT now() NOT NULL,
    failed_attempts integer DEFAULT 0 NOT NULL,
    locked_until timestamptz,
    created_at timestamptz DEFAULT now() NOT NULL,
    updated_at timestamptz DEFAULT now() NOT NULL,
    must_change_password boolean DEFAULT false NOT NULL,
    CONSTRAINT user_credentials_failed_attempts_check CHECK ((failed_attempts >= 0))
);


--
-- Name: TABLE user_credentials; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.user_credentials IS '普通用户密码凭据和登录锁定状态，一名用户一条记录。';


--
-- Name: user_mfa_totp; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_mfa_totp (
    user_id uuid NOT NULL,
    secret_ciphertext bytea NOT NULL,
    secret_nonce bytea NOT NULL,
    enabled_at timestamptz,
    last_used_step bigint,
    created_at timestamptz DEFAULT now() NOT NULL,
    updated_at timestamptz DEFAULT now() NOT NULL
);


--
-- Name: TABLE user_mfa_totp; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.user_mfa_totp IS '普通用户 TOTP 多因素认证配置，密钥以密文保存。';


--
-- Name: users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.users (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    phone text,
    email text,
    status text DEFAULT 'active'::text NOT NULL,
    created_at timestamptz DEFAULT now() NOT NULL,
    updated_at timestamptz DEFAULT now() NOT NULL,
    phone_verified_at timestamptz,
    email_verified_at timestamptz,
    last_login_at timestamptz,
    auth_version integer DEFAULT 0 NOT NULL,
    CONSTRAINT users_auth_version_check CHECK ((auth_version >= 0)),
    CONSTRAINT users_check CHECK (((NULLIF(btrim(phone), ''::text) IS NOT NULL) OR (NULLIF(btrim(email), ''::text) IS NOT NULL))),
    CONSTRAINT users_status_check CHECK ((status = ANY (ARRAY['active'::text, 'disabled'::text])))
);


--
-- Name: TABLE users; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.users IS '平台普通用户主表，保存身份、联系方式、账号状态和认证版本，不保存密码正文。';


--
-- Name: workspace_member_permissions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.workspace_member_permissions (
    member_id uuid NOT NULL,
    permission_id uuid NOT NULL
);


--
-- Name: TABLE workspace_member_permissions; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.workspace_member_permissions IS '工作区成员最终拥有的显式权限集合。';


--
-- Name: workspace_members; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.workspace_members (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    user_id uuid NOT NULL,
    role_id uuid NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    joined_at timestamptz DEFAULT now() NOT NULL,
    created_at timestamptz DEFAULT now() NOT NULL,
    updated_at timestamptz DEFAULT now() NOT NULL,
    scope_type text DEFAULT 'workspace'::text NOT NULL,
    scope_id uuid NOT NULL,
    template_code text NOT NULL,
    CONSTRAINT workspace_members_scope_type_check CHECK ((scope_type = ANY (ARRAY['workspace'::text, 'project'::text, 'site'::text, 'device'::text, 'dataset'::text]))),
    CONSTRAINT workspace_members_status_check CHECK ((status = ANY (ARRAY['active'::text, 'disabled'::text, 'removed'::text])))
);


--
-- Name: TABLE workspace_members; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.workspace_members IS '用户加入工作区的成员关系，包含角色、权限模板和资源作用域。';


--
-- Name: workspaces; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.workspaces (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    type text NOT NULL,
    organization_type text,
    name text NOT NULL,
    owner_user_id uuid NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    created_at timestamptz DEFAULT now() NOT NULL,
    updated_at timestamptz DEFAULT now() NOT NULL,
    CONSTRAINT workspaces_check CHECK ((((type = 'personal'::text) AND (organization_type IS NULL)) OR ((type = 'organization'::text) AND (organization_type IS NOT NULL) AND (organization_type = ANY (ARRAY['lab'::text, 'institution'::text, 'company'::text, 'government'::text, 'service_provider'::text, 'other'::text]))))),
    CONSTRAINT workspaces_status_check CHECK ((status = ANY (ARRAY['active'::text, 'disabled'::text]))),
    CONSTRAINT workspaces_type_check CHECK ((type = ANY (ARRAY['personal'::text, 'organization'::text])))
);


--
-- Name: TABLE workspaces; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.workspaces IS '平台租户边界，保存工作区名称、类型、所有者和状态。';


--
-- Name: access_grant_permissions access_grant_permissions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.access_grant_permissions
    ADD CONSTRAINT access_grant_permissions_pkey PRIMARY KEY (access_grant_id, permission_id);


--
-- Name: access_grants access_grants_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.access_grants
    ADD CONSTRAINT access_grants_pkey PRIMARY KEY (id);


--
-- Name: audit_logs audit_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_logs
    ADD CONSTRAINT audit_logs_pkey PRIMARY KEY (id);


--
-- Name: auth_access_token_blacklist auth_access_token_blacklist_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.auth_access_token_blacklist
    ADD CONSTRAINT auth_access_token_blacklist_pkey PRIMARY KEY (token_hash);


--
-- Name: auth_password_change_sessions auth_password_change_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.auth_password_change_sessions
    ADD CONSTRAINT auth_password_change_sessions_pkey PRIMARY KEY (id);


--
-- Name: auth_password_change_sessions auth_password_change_sessions_token_hash_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.auth_password_change_sessions
    ADD CONSTRAINT auth_password_change_sessions_token_hash_key UNIQUE (token_hash);


--
-- Name: auth_refresh_sessions auth_refresh_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.auth_refresh_sessions
    ADD CONSTRAINT auth_refresh_sessions_pkey PRIMARY KEY (id);


--
-- Name: auth_refresh_sessions auth_refresh_sessions_refresh_token_hash_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.auth_refresh_sessions
    ADD CONSTRAINT auth_refresh_sessions_refresh_token_hash_key UNIQUE (refresh_token_hash);


--
-- Name: camera_bindings camera_bindings_device_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.camera_bindings
    ADD CONSTRAINT camera_bindings_device_id_key UNIQUE (device_id);


--
-- Name: camera_bindings camera_bindings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.camera_bindings
    ADD CONSTRAINT camera_bindings_pkey PRIMARY KEY (id);


--
-- Name: camera_bindings camera_bindings_provider_device_serial_channel_no_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.camera_bindings
    ADD CONSTRAINT camera_bindings_provider_device_serial_channel_no_key UNIQUE (provider, device_serial, channel_no);


--
-- Name: computed_data_streams computed_data_streams_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.computed_data_streams
    ADD CONSTRAINT computed_data_streams_pkey PRIMARY KEY (data_stream_id);


--
-- Name: data_sources data_sources_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.data_sources
    ADD CONSTRAINT data_sources_pkey PRIMARY KEY (id);


--
-- Name: data_stream_bindings data_stream_bindings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.data_stream_bindings
    ADD CONSTRAINT data_stream_bindings_pkey PRIMARY KEY (id);


--
-- Name: data_streams data_streams_device_id_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.data_streams
    ADD CONSTRAINT data_streams_device_id_code_key UNIQUE (device_id, code);


--
-- Name: data_streams data_streams_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.data_streams
    ADD CONSTRAINT data_streams_pkey PRIMARY KEY (id);


--
-- Name: dataset_sources dataset_sources_dataset_id_source_type_source_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dataset_sources
    ADD CONSTRAINT dataset_sources_dataset_id_source_type_source_id_key UNIQUE (dataset_id, source_type, source_id);


--
-- Name: dataset_sources dataset_sources_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dataset_sources
    ADD CONSTRAINT dataset_sources_pkey PRIMARY KEY (id);


--
-- Name: datasets datasets_id_workspace_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.datasets
    ADD CONSTRAINT datasets_id_workspace_id_key UNIQUE (id, workspace_id);


--
-- Name: datasets datasets_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.datasets
    ADD CONSTRAINT datasets_pkey PRIMARY KEY (id);


--
-- Name: device_assignments device_assignments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.device_assignments
    ADD CONSTRAINT device_assignments_pkey PRIMARY KEY (id);


--
-- Name: device_capabilities device_capabilities_device_id_capability_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.device_capabilities
    ADD CONSTRAINT device_capabilities_device_id_capability_code_key UNIQUE (device_id, capability_code);


--
-- Name: device_capabilities device_capabilities_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.device_capabilities
    ADD CONSTRAINT device_capabilities_pkey PRIMARY KEY (id);


--
-- Name: device_capability_definitions device_capability_definitions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.device_capability_definitions
    ADD CONSTRAINT device_capability_definitions_pkey PRIMARY KEY (code);


--
-- Name: device_claim_credentials device_claim_credentials_claim_slug_hash_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.device_claim_credentials
    ADD CONSTRAINT device_claim_credentials_claim_slug_hash_key UNIQUE (claim_slug_hash);


--
-- Name: device_claim_credentials device_claim_credentials_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.device_claim_credentials
    ADD CONSTRAINT device_claim_credentials_pkey PRIMARY KEY (device_id);


--
-- Name: device_claim_requests device_claim_requests_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.device_claim_requests
    ADD CONSTRAINT device_claim_requests_pkey PRIMARY KEY (id);


--
-- Name: device_claim_requests device_claim_requests_user_id_idempotency_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.device_claim_requests
    ADD CONSTRAINT device_claim_requests_user_id_idempotency_key_key UNIQUE (user_id, idempotency_key);


--
-- Name: device_config_snapshots device_config_snapshots_data_source_id_adapter_code_externa_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.device_config_snapshots
    ADD CONSTRAINT device_config_snapshots_data_source_id_adapter_code_externa_key UNIQUE (data_source_id, adapter_code, external_config_id);


--
-- Name: device_config_snapshots device_config_snapshots_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.device_config_snapshots
    ADD CONSTRAINT device_config_snapshots_pkey PRIMARY KEY (id);


--
-- Name: device_environment_profiles device_environment_profiles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.device_environment_profiles
    ADD CONSTRAINT device_environment_profiles_pkey PRIMARY KEY (device_id);


--
-- Name: device_environment_terms device_environment_terms_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.device_environment_terms
    ADD CONSTRAINT device_environment_terms_pkey PRIMARY KEY (device_id, term_id);


--
-- Name: device_lifecycle_events device_lifecycle_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.device_lifecycle_events
    ADD CONSTRAINT device_lifecycle_events_pkey PRIMARY KEY (id);


--
-- Name: device_metadata device_metadata_device_id_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.device_metadata
    ADD CONSTRAINT device_metadata_device_id_key_key UNIQUE (device_id, key);


--
-- Name: device_metadata device_metadata_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.device_metadata
    ADD CONSTRAINT device_metadata_pkey PRIMARY KEY (id);


--
-- Name: device_operations device_operations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.device_operations
    ADD CONSTRAINT device_operations_pkey PRIMARY KEY (id);


--
-- Name: device_profile_images device_profile_images_object_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.device_profile_images
    ADD CONSTRAINT device_profile_images_object_key_key UNIQUE (object_key);


--
-- Name: device_profile_images device_profile_images_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.device_profile_images
    ADD CONSTRAINT device_profile_images_pkey PRIMARY KEY (id);


--
-- Name: device_profiles device_profiles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.device_profiles
    ADD CONSTRAINT device_profiles_pkey PRIMARY KEY (device_id);


--
-- Name: device_publications device_publications_device_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.device_publications
    ADD CONSTRAINT device_publications_device_id_key UNIQUE (device_id);


--
-- Name: device_publications device_publications_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.device_publications
    ADD CONSTRAINT device_publications_pkey PRIMARY KEY (id);


--
-- Name: device_publications device_publications_public_slug_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.device_publications
    ADD CONSTRAINT device_publications_public_slug_key UNIQUE (public_slug);


--
-- Name: device_relations device_relations_data_source_id_relation_type_external_pare_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.device_relations
    ADD CONSTRAINT device_relations_data_source_id_relation_type_external_pare_key UNIQUE (data_source_id, relation_type, external_parent_device_id, external_child_device_id);


--
-- Name: device_relations device_relations_parent_device_id_child_device_id_relation__key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.device_relations
    ADD CONSTRAINT device_relations_parent_device_id_child_device_id_relation__key UNIQUE (parent_device_id, child_device_id, relation_type);


--
-- Name: device_relations device_relations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.device_relations
    ADD CONSTRAINT device_relations_pkey PRIMARY KEY (id);


--
-- Name: device_source_refs device_source_refs_data_source_id_adapter_code_external_dev_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.device_source_refs
    ADD CONSTRAINT device_source_refs_data_source_id_adapter_code_external_dev_key UNIQUE (data_source_id, adapter_code, external_device_id);


--
-- Name: device_source_refs device_source_refs_device_id_data_source_id_adapter_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.device_source_refs
    ADD CONSTRAINT device_source_refs_device_id_data_source_id_adapter_code_key UNIQUE (device_id, data_source_id, adapter_code);


--
-- Name: device_source_refs device_source_refs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.device_source_refs
    ADD CONSTRAINT device_source_refs_pkey PRIMARY KEY (id);


--
-- Name: device_taxonomy_terms device_taxonomy_terms_kind_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.device_taxonomy_terms
    ADD CONSTRAINT device_taxonomy_terms_kind_code_key UNIQUE (kind, code);


--
-- Name: device_taxonomy_terms device_taxonomy_terms_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.device_taxonomy_terms
    ADD CONSTRAINT device_taxonomy_terms_pkey PRIMARY KEY (id);


--
-- Name: devices devices_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.devices
    ADD CONSTRAINT devices_pkey PRIMARY KEY (id);


--
-- Name: export_jobs export_jobs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.export_jobs
    ADD CONSTRAINT export_jobs_pkey PRIMARY KEY (id);


--
-- Name: invitation_permissions invitation_permissions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invitation_permissions
    ADD CONSTRAINT invitation_permissions_pkey PRIMARY KEY (invitation_id, permission_id);


--
-- Name: invitations invitations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invitations
    ADD CONSTRAINT invitations_pkey PRIMARY KEY (id);


--
-- Name: permissions permissions_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.permissions
    ADD CONSTRAINT permissions_code_key UNIQUE (code);


--
-- Name: permissions permissions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.permissions
    ADD CONSTRAINT permissions_pkey PRIMARY KEY (id);


--
-- Name: projects projects_id_workspace_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.projects
    ADD CONSTRAINT projects_id_workspace_id_key UNIQUE (id, workspace_id);


--
-- Name: projects projects_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.projects
    ADD CONSTRAINT projects_pkey PRIMARY KEY (id);


--
-- Name: role_permissions role_permissions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.role_permissions
    ADD CONSTRAINT role_permissions_pkey PRIMARY KEY (role_id, permission_id);


--
-- Name: roles roles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.roles
    ADD CONSTRAINT roles_pkey PRIMARY KEY (id);


--
-- Name: site_environment_profiles site_environment_profiles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.site_environment_profiles
    ADD CONSTRAINT site_environment_profiles_pkey PRIMARY KEY (site_id);


--
-- Name: site_environment_terms site_environment_terms_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.site_environment_terms
    ADD CONSTRAINT site_environment_terms_pkey PRIMARY KEY (site_id, term_id);


--
-- Name: sites sites_id_project_id_workspace_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sites
    ADD CONSTRAINT sites_id_project_id_workspace_id_key UNIQUE (id, project_id, workspace_id);


--
-- Name: sites sites_id_workspace_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sites
    ADD CONSTRAINT sites_id_workspace_id_key UNIQUE (id, workspace_id);


--
-- Name: sites sites_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sites
    ADD CONSTRAINT sites_pkey PRIMARY KEY (id);


--
-- Name: system_admin_refresh_sessions system_admin_refresh_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.system_admin_refresh_sessions
    ADD CONSTRAINT system_admin_refresh_sessions_pkey PRIMARY KEY (id);


--
-- Name: system_admin_refresh_sessions system_admin_refresh_sessions_refresh_token_hash_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.system_admin_refresh_sessions
    ADD CONSTRAINT system_admin_refresh_sessions_refresh_token_hash_key UNIQUE (refresh_token_hash);


--
-- Name: system_admins system_admins_email_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.system_admins
    ADD CONSTRAINT system_admins_email_key UNIQUE (email);


--
-- Name: system_admins system_admins_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.system_admins
    ADD CONSTRAINT system_admins_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.sensor_templates
    ADD CONSTRAINT sensor_templates_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.system_admins(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.sensor_templates
    ADD CONSTRAINT sensor_templates_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.system_admins(id) ON DELETE SET NULL;


--
-- Name: user_credentials user_credentials_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_credentials
    ADD CONSTRAINT user_credentials_pkey PRIMARY KEY (user_id);


--
-- Name: user_mfa_totp user_mfa_totp_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_mfa_totp
    ADD CONSTRAINT user_mfa_totp_pkey PRIMARY KEY (user_id);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: workspace_member_permissions workspace_member_permissions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspace_member_permissions
    ADD CONSTRAINT workspace_member_permissions_pkey PRIMARY KEY (member_id, permission_id);


--
-- Name: workspace_members workspace_members_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspace_members
    ADD CONSTRAINT workspace_members_pkey PRIMARY KEY (id);


--
-- Name: workspace_members workspace_members_workspace_id_user_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspace_members
    ADD CONSTRAINT workspace_members_workspace_id_user_id_key UNIQUE (workspace_id, user_id);


--
-- Name: workspaces workspaces_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspaces
    ADD CONSTRAINT workspaces_pkey PRIMARY KEY (id);


--
-- Name: access_grant_permissions_permission_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX access_grant_permissions_permission_idx ON public.access_grant_permissions USING btree (permission_id);


--
-- Name: access_grants_active_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX access_grants_active_unique ON public.access_grants USING btree (workspace_id, subject_type, subject_id, scope_type, scope_id) WHERE (status = 'active'::text);


--
-- Name: access_grants_parent_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX access_grants_parent_idx ON public.access_grants USING btree (parent_grant_id, status) WHERE (parent_grant_id IS NOT NULL);


--
-- Name: access_grants_subject_active_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX access_grants_subject_active_idx ON public.access_grants USING btree (subject_type, subject_id, workspace_id, scope_type, scope_id) WHERE (status = 'active'::text);


--
-- Name: access_grants_workspace_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX access_grants_workspace_idx ON public.access_grants USING btree (workspace_id, created_at DESC);


--
-- Name: audit_logs_actor_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX audit_logs_actor_created_idx ON public.audit_logs USING btree (actor_type, actor_id, created_at DESC);


--
-- Name: audit_logs_admin_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX audit_logs_admin_created_idx ON public.audit_logs USING btree (actor_admin_id, created_at DESC) WHERE (actor_admin_id IS NOT NULL);


--
-- Name: audit_logs_resource_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX audit_logs_resource_created_idx ON public.audit_logs USING btree (resource_type, resource_id, created_at DESC);


--
-- Name: audit_logs_workspace_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX audit_logs_workspace_created_idx ON public.audit_logs USING btree (workspace_id, created_at DESC);


--
-- Name: auth_access_token_blacklist_expires_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX auth_access_token_blacklist_expires_at_idx ON public.auth_access_token_blacklist USING btree (expires_at);


--
-- Name: auth_password_change_sessions_active_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX auth_password_change_sessions_active_idx ON public.auth_password_change_sessions USING btree (token_hash, expires_at) WHERE (used_at IS NULL);


--
-- Name: auth_password_change_sessions_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX auth_password_change_sessions_user_idx ON public.auth_password_change_sessions USING btree (user_id, expires_at DESC);


--
-- Name: auth_refresh_sessions_active_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX auth_refresh_sessions_active_idx ON public.auth_refresh_sessions USING btree (user_id, expires_at) WHERE (revoked_at IS NULL);


--
-- Name: auth_refresh_sessions_user_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX auth_refresh_sessions_user_id_idx ON public.auth_refresh_sessions USING btree (user_id);


--
-- Name: camera_bindings_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX camera_bindings_status_idx ON public.camera_bindings USING btree (status, created_at DESC);


--
-- Name: data_sources_name_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX data_sources_name_unique ON public.data_sources USING btree (lower(name));


--
-- Name: data_sources_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX data_sources_status_idx ON public.data_sources USING btree (status, created_at DESC);


--
-- Name: data_stream_bindings_mapping_unique_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX data_stream_bindings_mapping_unique_idx ON public.data_stream_bindings USING btree (data_stream_id, data_source_id, adapter_code, payload_type, COALESCE(table_name, ''::text), COALESCE(device_key_field, ''::text), COALESCE(device_key_value, ''::text), COALESCE(time_field, ''::text), COALESCE(value_field, ''::text));


--
-- Name: data_stream_bindings_stream_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX data_stream_bindings_stream_status_idx ON public.data_stream_bindings USING btree (data_stream_id, status, created_at DESC);


--
-- Name: datasets_project_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX datasets_project_created_idx ON public.datasets USING btree (project_id, created_at DESC) WHERE (project_id IS NOT NULL);


--
-- Name: datasets_workspace_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX datasets_workspace_created_idx ON public.datasets USING btree (workspace_id, created_at DESC);


--
-- Name: device_assignments_active_device_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX device_assignments_active_device_unique ON public.device_assignments USING btree (device_id) WHERE (status = 'active'::text);


--
-- Name: device_assignments_project_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX device_assignments_project_idx ON public.device_assignments USING btree (project_id, status, assigned_at DESC) WHERE (project_id IS NOT NULL);


--
-- Name: device_assignments_site_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX device_assignments_site_idx ON public.device_assignments USING btree (site_id, status, assigned_at DESC) WHERE (site_id IS NOT NULL);


--
-- Name: device_assignments_workspace_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX device_assignments_workspace_idx ON public.device_assignments USING btree (workspace_id, status, assigned_at DESC);


--
-- Name: device_claim_credentials_manual_code_hash_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX device_claim_credentials_manual_code_hash_idx ON public.device_claim_credentials USING btree (manual_code_hash);


--
-- Name: device_claim_requests_device_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX device_claim_requests_device_id_idx ON public.device_claim_requests USING btree (device_id, created_at DESC);


--
-- Name: device_config_snapshots_device_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX device_config_snapshots_device_idx ON public.device_config_snapshots USING btree (device_id, synced_at DESC);


--
-- Name: device_config_snapshots_external_device_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX device_config_snapshots_external_device_idx ON public.device_config_snapshots USING btree (data_source_id, adapter_code, external_device_id, synced_at DESC);


--
-- Name: device_environment_profiles_deployment_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX device_environment_profiles_deployment_idx ON public.device_environment_profiles USING btree (deployment_term_id);


--
-- Name: device_environment_profiles_ecosystem_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX device_environment_profiles_ecosystem_idx ON public.device_environment_profiles USING btree (ecosystem_term_id);


--
-- Name: device_environment_profiles_management_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX device_environment_profiles_management_idx ON public.device_environment_profiles USING btree (management_term_id);


--
-- Name: device_environment_terms_term_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX device_environment_terms_term_idx ON public.device_environment_terms USING btree (term_id, device_id);


--
-- Name: device_lifecycle_events_device_time_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX device_lifecycle_events_device_time_idx ON public.device_lifecycle_events USING btree (device_id, occurred_at DESC, id DESC);


--
-- Name: device_operations_device_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX device_operations_device_created_at_idx ON public.device_operations USING btree (device_id, created_at DESC);


--
-- Name: device_operations_workspace_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX device_operations_workspace_created_at_idx ON public.device_operations USING btree (workspace_id, created_at DESC);


--
-- Name: device_profile_images_cover_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX device_profile_images_cover_unique ON public.device_profile_images USING btree (device_id) WHERE (is_cover = true);


--
-- Name: device_profile_images_device_order_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX device_profile_images_device_order_idx ON public.device_profile_images USING btree (device_id, sort_order, created_at, id);


--
-- Name: device_relations_active_child_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX device_relations_active_child_unique ON public.device_relations USING btree (child_device_id) WHERE ((relation_type = 'gateway_node'::text) AND (status = 'active'::text));


--
-- Name: device_relations_child_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX device_relations_child_status_idx ON public.device_relations USING btree (child_device_id, relation_type, status, synced_at DESC);


--
-- Name: device_relations_external_parent_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX device_relations_external_parent_idx ON public.device_relations USING btree (data_source_id, relation_type, external_parent_device_id, status);


--
-- Name: device_relations_parent_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX device_relations_parent_status_idx ON public.device_relations USING btree (parent_device_id, relation_type, status, synced_at DESC);


--
-- Name: device_source_refs_device_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX device_source_refs_device_idx ON public.device_source_refs USING btree (device_id, status);


--
-- Name: device_taxonomy_terms_catalog_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX device_taxonomy_terms_catalog_idx ON public.device_taxonomy_terms USING btree (kind, status, sort_order, name_zh);


--
-- Name: devices_serial_no_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX devices_serial_no_unique ON public.devices USING btree (serial_no);


--
-- Name: export_jobs_requested_by_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX export_jobs_requested_by_created_idx ON public.export_jobs USING btree (requested_by, created_at DESC);


--
-- Name: export_jobs_status_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX export_jobs_status_created_idx ON public.export_jobs USING btree (status, created_at);


--
-- Name: export_jobs_workspace_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX export_jobs_workspace_created_idx ON public.export_jobs USING btree (workspace_id, created_at DESC);


--
-- Name: invitation_permissions_permission_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX invitation_permissions_permission_idx ON public.invitation_permissions USING btree (permission_id);


--
-- Name: invitations_invitee_email_pending_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX invitations_invitee_email_pending_idx ON public.invitations USING btree (invitee_email) WHERE ((status = 'pending'::text) AND (invitee_email IS NOT NULL));


--
-- Name: invitations_invitee_phone_pending_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX invitations_invitee_phone_pending_idx ON public.invitations USING btree (invitee_phone) WHERE ((status = 'pending'::text) AND (invitee_phone IS NOT NULL));


--
-- Name: invitations_workspace_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX invitations_workspace_idx ON public.invitations USING btree (workspace_id, created_at DESC);


--
-- Name: projects_workspace_active_name_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX projects_workspace_active_name_unique ON public.projects USING btree (workspace_id, lower(name)) WHERE (status = 'active'::text);


--
-- Name: roles_system_code_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX roles_system_code_unique ON public.roles USING btree (code) WHERE (workspace_id IS NULL);


--
-- Name: roles_workspace_code_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX roles_workspace_code_unique ON public.roles USING btree (workspace_id, code) WHERE (workspace_id IS NOT NULL);


--
-- Name: site_environment_terms_term_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX site_environment_terms_term_idx ON public.site_environment_terms USING btree (term_id, site_id);


--
-- Name: sites_project_active_name_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX sites_project_active_name_unique ON public.sites USING btree (project_id, lower(name)) WHERE (status = 'active'::text);


--
-- Name: system_admin_refresh_sessions_active_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX system_admin_refresh_sessions_active_idx ON public.system_admin_refresh_sessions USING btree (admin_id, expires_at) WHERE (revoked_at IS NULL);


--
-- Name: system_admin_refresh_sessions_admin_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX system_admin_refresh_sessions_admin_id_idx ON public.system_admin_refresh_sessions USING btree (admin_id);


--
-- Name: user_mfa_totp_enabled_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX user_mfa_totp_enabled_idx ON public.user_mfa_totp USING btree (user_id) WHERE (enabled_at IS NOT NULL);


--
-- Name: users_email_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX users_email_unique ON public.users USING btree (email) WHERE (email IS NOT NULL);


--
-- Name: users_phone_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX users_phone_unique ON public.users USING btree (phone) WHERE (phone IS NOT NULL);


--
-- Name: workspace_member_permissions_permission_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX workspace_member_permissions_permission_idx ON public.workspace_member_permissions USING btree (permission_id);


--
-- Name: workspace_members_scope_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX workspace_members_scope_status_idx ON public.workspace_members USING btree (workspace_id, scope_type, scope_id, status);


--
-- Name: workspaces_personal_owner_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX workspaces_personal_owner_unique ON public.workspaces USING btree (owner_user_id) WHERE (type = 'personal'::text);


--
-- Name: device_assignments device_assignments_reject_gateway_node; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER device_assignments_reject_gateway_node BEFORE INSERT OR UPDATE OF status, device_id ON public.device_assignments FOR EACH ROW EXECUTE FUNCTION public.reject_gateway_node_assignment();


--
-- Name: workspaces workspaces_block_delete_with_devices; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER workspaces_block_delete_with_devices BEFORE DELETE ON public.workspaces FOR EACH ROW EXECUTE FUNCTION public.block_workspace_delete_with_devices();


--
-- Name: access_grant_permissions access_grant_permissions_access_grant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.access_grant_permissions
    ADD CONSTRAINT access_grant_permissions_access_grant_id_fkey FOREIGN KEY (access_grant_id) REFERENCES public.access_grants(id) ON DELETE CASCADE;


--
-- Name: access_grant_permissions access_grant_permissions_permission_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.access_grant_permissions
    ADD CONSTRAINT access_grant_permissions_permission_id_fkey FOREIGN KEY (permission_id) REFERENCES public.permissions(id) ON DELETE CASCADE;


--
-- Name: access_grants access_grants_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.access_grants
    ADD CONSTRAINT access_grants_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: access_grants access_grants_parent_grant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.access_grants
    ADD CONSTRAINT access_grants_parent_grant_id_fkey FOREIGN KEY (parent_grant_id) REFERENCES public.access_grants(id) ON DELETE SET NULL;


--
-- Name: access_grants access_grants_role_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.access_grants
    ADD CONSTRAINT access_grants_role_id_fkey FOREIGN KEY (role_id) REFERENCES public.roles(id);


--
-- Name: access_grants access_grants_subject_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.access_grants
    ADD CONSTRAINT access_grants_subject_id_fkey FOREIGN KEY (subject_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: access_grants access_grants_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.access_grants
    ADD CONSTRAINT access_grants_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: audit_logs audit_logs_actor_admin_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_logs
    ADD CONSTRAINT audit_logs_actor_admin_id_fkey FOREIGN KEY (actor_admin_id) REFERENCES public.system_admins(id) ON DELETE SET NULL;


--
-- Name: audit_logs audit_logs_actor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_logs
    ADD CONSTRAINT audit_logs_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: audit_logs audit_logs_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_logs
    ADD CONSTRAINT audit_logs_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE SET NULL;


--
-- Name: auth_access_token_blacklist auth_access_token_blacklist_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.auth_access_token_blacklist
    ADD CONSTRAINT auth_access_token_blacklist_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: auth_password_change_sessions auth_password_change_sessions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.auth_password_change_sessions
    ADD CONSTRAINT auth_password_change_sessions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: auth_refresh_sessions auth_refresh_sessions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.auth_refresh_sessions
    ADD CONSTRAINT auth_refresh_sessions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: camera_bindings camera_bindings_device_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.camera_bindings
    ADD CONSTRAINT camera_bindings_device_id_fkey FOREIGN KEY (device_id) REFERENCES public.devices(id) ON DELETE CASCADE;


--
-- Name: computed_data_streams computed_data_streams_data_stream_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.computed_data_streams
    ADD CONSTRAINT computed_data_streams_data_stream_id_fkey FOREIGN KEY (data_stream_id) REFERENCES public.data_streams(id) ON DELETE CASCADE;


--
-- Name: data_sources data_sources_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.data_sources
    ADD CONSTRAINT data_sources_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.system_admins(id);


--
-- Name: data_stream_bindings data_stream_bindings_data_source_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.data_stream_bindings
    ADD CONSTRAINT data_stream_bindings_data_source_id_fkey FOREIGN KEY (data_source_id) REFERENCES public.data_sources(id);


--
-- Name: data_stream_bindings data_stream_bindings_data_stream_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.data_stream_bindings
    ADD CONSTRAINT data_stream_bindings_data_stream_id_fkey FOREIGN KEY (data_stream_id) REFERENCES public.data_streams(id) ON DELETE CASCADE;


--
-- Name: data_streams data_streams_device_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.data_streams
    ADD CONSTRAINT data_streams_device_id_fkey FOREIGN KEY (device_id) REFERENCES public.devices(id) ON DELETE CASCADE;


--
-- Name: dataset_sources dataset_sources_dataset_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dataset_sources
    ADD CONSTRAINT dataset_sources_dataset_id_fkey FOREIGN KEY (dataset_id) REFERENCES public.datasets(id) ON DELETE CASCADE;


--
-- Name: datasets datasets_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.datasets
    ADD CONSTRAINT datasets_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: datasets datasets_project_id_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.datasets
    ADD CONSTRAINT datasets_project_id_workspace_id_fkey FOREIGN KEY (project_id, workspace_id) REFERENCES public.projects(id, workspace_id);


--
-- Name: datasets datasets_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.datasets
    ADD CONSTRAINT datasets_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: device_assignments device_assignments_device_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.device_assignments
    ADD CONSTRAINT device_assignments_device_id_fkey FOREIGN KEY (device_id) REFERENCES public.devices(id) ON DELETE CASCADE;


--
-- Name: device_assignments device_assignments_project_id_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.device_assignments
    ADD CONSTRAINT device_assignments_project_id_workspace_id_fkey FOREIGN KEY (project_id, workspace_id) REFERENCES public.projects(id, workspace_id);


--
-- Name: device_assignments device_assignments_site_id_project_id_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.device_assignments
    ADD CONSTRAINT device_assignments_site_id_project_id_workspace_id_fkey FOREIGN KEY (site_id, project_id, workspace_id) REFERENCES public.sites(id, project_id, workspace_id);


--
-- Name: device_assignments device_assignments_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.device_assignments
    ADD CONSTRAINT device_assignments_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: device_capabilities device_capabilities_capability_code_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.device_capabilities
    ADD CONSTRAINT device_capabilities_capability_code_fkey FOREIGN KEY (capability_code) REFERENCES public.device_capability_definitions(code) ON UPDATE CASCADE;


--
-- Name: device_capabilities device_capabilities_device_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.device_capabilities
    ADD CONSTRAINT device_capabilities_device_id_fkey FOREIGN KEY (device_id) REFERENCES public.devices(id) ON DELETE CASCADE;


--
-- Name: device_claim_credentials device_claim_credentials_device_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.device_claim_credentials
    ADD CONSTRAINT device_claim_credentials_device_id_fkey FOREIGN KEY (device_id) REFERENCES public.devices(id) ON DELETE CASCADE;


--
-- Name: device_claim_requests device_claim_requests_assignment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.device_claim_requests
    ADD CONSTRAINT device_claim_requests_assignment_id_fkey FOREIGN KEY (assignment_id) REFERENCES public.device_assignments(id) ON DELETE CASCADE;


--
-- Name: device_claim_requests device_claim_requests_device_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.device_claim_requests
    ADD CONSTRAINT device_claim_requests_device_id_fkey FOREIGN KEY (device_id) REFERENCES public.devices(id) ON DELETE CASCADE;


--
-- Name: device_claim_requests device_claim_requests_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.device_claim_requests
    ADD CONSTRAINT device_claim_requests_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: device_claim_requests device_claim_requests_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.device_claim_requests
    ADD CONSTRAINT device_claim_requests_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: device_config_snapshots device_config_snapshots_data_source_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.device_config_snapshots
    ADD CONSTRAINT device_config_snapshots_data_source_id_fkey FOREIGN KEY (data_source_id) REFERENCES public.data_sources(id);


--
-- Name: device_config_snapshots device_config_snapshots_device_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.device_config_snapshots
    ADD CONSTRAINT device_config_snapshots_device_id_fkey FOREIGN KEY (device_id) REFERENCES public.devices(id) ON DELETE CASCADE;


--
-- Name: device_environment_profiles device_environment_profiles_deployment_term_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.device_environment_profiles
    ADD CONSTRAINT device_environment_profiles_deployment_term_id_fkey FOREIGN KEY (deployment_term_id) REFERENCES public.device_taxonomy_terms(id) ON DELETE RESTRICT;


--
-- Name: device_environment_profiles device_environment_profiles_device_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.device_environment_profiles
    ADD CONSTRAINT device_environment_profiles_device_id_fkey FOREIGN KEY (device_id) REFERENCES public.devices(id) ON DELETE CASCADE;


--
-- Name: device_environment_profiles device_environment_profiles_ecosystem_term_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.device_environment_profiles
    ADD CONSTRAINT device_environment_profiles_ecosystem_term_id_fkey FOREIGN KEY (ecosystem_term_id) REFERENCES public.device_taxonomy_terms(id) ON DELETE RESTRICT;


--
-- Name: device_environment_profiles device_environment_profiles_management_term_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.device_environment_profiles
    ADD CONSTRAINT device_environment_profiles_management_term_id_fkey FOREIGN KEY (management_term_id) REFERENCES public.device_taxonomy_terms(id) ON DELETE RESTRICT;


--
-- Name: device_environment_terms device_environment_terms_device_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.device_environment_terms
    ADD CONSTRAINT device_environment_terms_device_id_fkey FOREIGN KEY (device_id) REFERENCES public.devices(id) ON DELETE CASCADE;


--
-- Name: device_environment_terms device_environment_terms_term_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.device_environment_terms
    ADD CONSTRAINT device_environment_terms_term_id_fkey FOREIGN KEY (term_id) REFERENCES public.device_taxonomy_terms(id) ON DELETE RESTRICT;


--
-- Name: device_lifecycle_events device_lifecycle_events_actor_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.device_lifecycle_events
    ADD CONSTRAINT device_lifecycle_events_actor_user_id_fkey FOREIGN KEY (actor_user_id) REFERENCES public.users(id);


--
-- Name: device_lifecycle_events device_lifecycle_events_device_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.device_lifecycle_events
    ADD CONSTRAINT device_lifecycle_events_device_id_fkey FOREIGN KEY (device_id) REFERENCES public.devices(id) ON DELETE CASCADE;


--
-- Name: device_metadata device_metadata_device_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.device_metadata
    ADD CONSTRAINT device_metadata_device_id_fkey FOREIGN KEY (device_id) REFERENCES public.devices(id) ON DELETE CASCADE;


--
-- Name: device_operations device_operations_device_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.device_operations
    ADD CONSTRAINT device_operations_device_id_fkey FOREIGN KEY (device_id) REFERENCES public.devices(id) ON DELETE CASCADE;


--
-- Name: device_operations device_operations_requested_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.device_operations
    ADD CONSTRAINT device_operations_requested_by_fkey FOREIGN KEY (requested_by) REFERENCES public.users(id);


--
-- Name: device_operations device_operations_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.device_operations
    ADD CONSTRAINT device_operations_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: device_profile_images device_profile_images_device_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.device_profile_images
    ADD CONSTRAINT device_profile_images_device_id_fkey FOREIGN KEY (device_id) REFERENCES public.devices(id) ON DELETE CASCADE;


--
-- Name: device_profile_images device_profile_images_uploaded_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.device_profile_images
    ADD CONSTRAINT device_profile_images_uploaded_by_fkey FOREIGN KEY (uploaded_by) REFERENCES public.users(id);


--
-- Name: device_profiles device_profiles_device_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.device_profiles
    ADD CONSTRAINT device_profiles_device_id_fkey FOREIGN KEY (device_id) REFERENCES public.devices(id) ON DELETE CASCADE;


--
-- Name: device_profiles device_profiles_updated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.device_profiles
    ADD CONSTRAINT device_profiles_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.users(id);


--
-- Name: device_publications device_publications_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.device_publications
    ADD CONSTRAINT device_publications_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: device_publications device_publications_device_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.device_publications
    ADD CONSTRAINT device_publications_device_id_fkey FOREIGN KEY (device_id) REFERENCES public.devices(id) ON DELETE CASCADE;


--
-- Name: device_publications device_publications_updated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.device_publications
    ADD CONSTRAINT device_publications_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.users(id);


--
-- Name: device_relations device_relations_child_device_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.device_relations
    ADD CONSTRAINT device_relations_child_device_id_fkey FOREIGN KEY (child_device_id) REFERENCES public.devices(id) ON DELETE CASCADE;


--
-- Name: device_relations device_relations_data_source_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.device_relations
    ADD CONSTRAINT device_relations_data_source_id_fkey FOREIGN KEY (data_source_id) REFERENCES public.data_sources(id) ON DELETE CASCADE;


--
-- Name: device_relations device_relations_parent_device_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.device_relations
    ADD CONSTRAINT device_relations_parent_device_id_fkey FOREIGN KEY (parent_device_id) REFERENCES public.devices(id) ON DELETE CASCADE;


--
-- Name: device_source_refs device_source_refs_data_source_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.device_source_refs
    ADD CONSTRAINT device_source_refs_data_source_id_fkey FOREIGN KEY (data_source_id) REFERENCES public.data_sources(id);


--
-- Name: device_source_refs device_source_refs_device_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.device_source_refs
    ADD CONSTRAINT device_source_refs_device_id_fkey FOREIGN KEY (device_id) REFERENCES public.devices(id) ON DELETE CASCADE;


--
-- Name: device_taxonomy_terms device_taxonomy_terms_parent_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.device_taxonomy_terms
    ADD CONSTRAINT device_taxonomy_terms_parent_id_fkey FOREIGN KEY (parent_id) REFERENCES public.device_taxonomy_terms(id) ON DELETE RESTRICT;


--
-- Name: export_jobs export_jobs_requested_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.export_jobs
    ADD CONSTRAINT export_jobs_requested_by_fkey FOREIGN KEY (requested_by) REFERENCES public.users(id);


--
-- Name: export_jobs export_jobs_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.export_jobs
    ADD CONSTRAINT export_jobs_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: invitation_permissions invitation_permissions_invitation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invitation_permissions
    ADD CONSTRAINT invitation_permissions_invitation_id_fkey FOREIGN KEY (invitation_id) REFERENCES public.invitations(id) ON DELETE CASCADE;


--
-- Name: invitation_permissions invitation_permissions_permission_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invitation_permissions
    ADD CONSTRAINT invitation_permissions_permission_id_fkey FOREIGN KEY (permission_id) REFERENCES public.permissions(id) ON DELETE CASCADE;


--
-- Name: invitations invitations_invited_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invitations
    ADD CONSTRAINT invitations_invited_by_fkey FOREIGN KEY (invited_by) REFERENCES public.users(id);


--
-- Name: invitations invitations_parent_grant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invitations
    ADD CONSTRAINT invitations_parent_grant_id_fkey FOREIGN KEY (parent_grant_id) REFERENCES public.access_grants(id) ON DELETE SET NULL;


--
-- Name: invitations invitations_role_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invitations
    ADD CONSTRAINT invitations_role_id_fkey FOREIGN KEY (role_id) REFERENCES public.roles(id);


--
-- Name: invitations invitations_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invitations
    ADD CONSTRAINT invitations_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: projects projects_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.projects
    ADD CONSTRAINT projects_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: projects projects_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.projects
    ADD CONSTRAINT projects_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: role_permissions role_permissions_permission_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.role_permissions
    ADD CONSTRAINT role_permissions_permission_id_fkey FOREIGN KEY (permission_id) REFERENCES public.permissions(id) ON DELETE CASCADE;


--
-- Name: role_permissions role_permissions_role_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.role_permissions
    ADD CONSTRAINT role_permissions_role_id_fkey FOREIGN KEY (role_id) REFERENCES public.roles(id) ON DELETE CASCADE;


--
-- Name: roles roles_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.roles
    ADD CONSTRAINT roles_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: site_environment_profiles site_environment_profiles_deployment_term_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.site_environment_profiles
    ADD CONSTRAINT site_environment_profiles_deployment_term_id_fkey FOREIGN KEY (deployment_term_id) REFERENCES public.device_taxonomy_terms(id) ON DELETE RESTRICT;


--
-- Name: site_environment_profiles site_environment_profiles_ecosystem_term_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.site_environment_profiles
    ADD CONSTRAINT site_environment_profiles_ecosystem_term_id_fkey FOREIGN KEY (ecosystem_term_id) REFERENCES public.device_taxonomy_terms(id) ON DELETE RESTRICT;


--
-- Name: site_environment_profiles site_environment_profiles_management_term_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.site_environment_profiles
    ADD CONSTRAINT site_environment_profiles_management_term_id_fkey FOREIGN KEY (management_term_id) REFERENCES public.device_taxonomy_terms(id) ON DELETE RESTRICT;


--
-- Name: site_environment_profiles site_environment_profiles_site_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.site_environment_profiles
    ADD CONSTRAINT site_environment_profiles_site_id_fkey FOREIGN KEY (site_id) REFERENCES public.sites(id) ON DELETE CASCADE;


--
-- Name: site_environment_terms site_environment_terms_site_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.site_environment_terms
    ADD CONSTRAINT site_environment_terms_site_id_fkey FOREIGN KEY (site_id) REFERENCES public.sites(id) ON DELETE CASCADE;


--
-- Name: site_environment_terms site_environment_terms_term_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.site_environment_terms
    ADD CONSTRAINT site_environment_terms_term_id_fkey FOREIGN KEY (term_id) REFERENCES public.device_taxonomy_terms(id) ON DELETE RESTRICT;


--
-- Name: sites sites_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sites
    ADD CONSTRAINT sites_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: sites sites_project_id_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sites
    ADD CONSTRAINT sites_project_id_workspace_id_fkey FOREIGN KEY (project_id, workspace_id) REFERENCES public.projects(id, workspace_id) ON DELETE CASCADE;


--
-- Name: sites sites_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sites
    ADD CONSTRAINT sites_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: system_admin_refresh_sessions system_admin_refresh_sessions_admin_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.system_admin_refresh_sessions
    ADD CONSTRAINT system_admin_refresh_sessions_admin_id_fkey FOREIGN KEY (admin_id) REFERENCES public.system_admins(id) ON DELETE CASCADE;


--
-- Name: user_credentials user_credentials_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_credentials
    ADD CONSTRAINT user_credentials_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: user_mfa_totp user_mfa_totp_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_mfa_totp
    ADD CONSTRAINT user_mfa_totp_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: workspace_member_permissions workspace_member_permissions_member_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspace_member_permissions
    ADD CONSTRAINT workspace_member_permissions_member_id_fkey FOREIGN KEY (member_id) REFERENCES public.workspace_members(id) ON DELETE CASCADE;


--
-- Name: workspace_member_permissions workspace_member_permissions_permission_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspace_member_permissions
    ADD CONSTRAINT workspace_member_permissions_permission_id_fkey FOREIGN KEY (permission_id) REFERENCES public.permissions(id) ON DELETE CASCADE;


--
-- Name: workspace_members workspace_members_role_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspace_members
    ADD CONSTRAINT workspace_members_role_id_fkey FOREIGN KEY (role_id) REFERENCES public.roles(id);


--
-- Name: workspace_members workspace_members_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspace_members
    ADD CONSTRAINT workspace_members_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: workspace_members workspace_members_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspace_members
    ADD CONSTRAINT workspace_members_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: workspaces workspaces_owner_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspaces
    ADD CONSTRAINT workspaces_owner_user_id_fkey FOREIGN KEY (owner_user_id) REFERENCES public.users(id);


--
-- PostgreSQL database dump complete
--



SET search_path = public;

-- System roles, permissions and role permission templates.

INSERT INTO roles (code, name, is_system_role)
VALUES
    ('owner', 'Owner', true),
    ('admin', 'Admin', true),
    ('project_manager', 'Project Manager', true),
    ('site_operator', 'Site Operator', true),
    ('data_manager', 'Data Manager', true),
    ('researcher', 'Researcher', true),
    ('viewer', 'Viewer', true),
    ('shared_viewer', 'Shared Viewer', true),
    ('shared_downloader', 'Shared Downloader', true),
    ('service_engineer', 'Service Engineer', true)
ON CONFLICT DO NOTHING;

INSERT INTO permissions (code, name, resource_type, action)
VALUES
    ('member.manage', '管理成员', 'member', 'manage'),
    ('workspace.view', '查看工作空间', 'workspace', 'view'),
    ('workspace.manage', '管理工作空间信息', 'workspace', 'manage'),
    ('project.view', '查看项目', 'project', 'view'),
    ('project.manage', '管理项目', 'project', 'manage'),
    ('site.view', '查看站点', 'site', 'view'),
    ('site.manage', '管理站点', 'site', 'manage'),
    ('device.view', '查看设备', 'device', 'view'),
    ('device.bind', '绑定设备', 'device', 'bind'),
    ('device.configure', '修改设备配置', 'device', 'configure'),
    ('device.calibrate', '设备校准', 'device', 'calibrate'),
    ('device.maintain', '设备诊断和维护', 'device', 'maintain'),
    ('device.firmware_upgrade', '固件升级', 'device', 'firmware_upgrade'),
    ('device.unbind', '解绑设备', 'device', 'unbind'),
    ('device.transfer', '转移设备', 'device', 'transfer'),
    ('telemetry.view_realtime', '查看实时数据', 'telemetry', 'view_realtime'),
    ('telemetry.view_history', '查看历史数据', 'telemetry', 'view_history'),
    ('telemetry.export', '导出数据', 'telemetry', 'export'),
    ('media.live_view', '查看实时画面', 'media', 'live_view'),
    ('media.archive_view', '查看历史图片/录像', 'media', 'archive_view'),
    ('media.download', '下载图片/视频', 'media', 'download'),
    ('media.delete', '删除图片/视频', 'media', 'delete'),
    ('media.ptz_control', '云台控制', 'media', 'ptz_control'),
    ('dataset.view', '查看数据集', 'dataset', 'view'),
    ('dataset.create', '创建数据集', 'dataset', 'create'),
    ('dataset.export', '导出数据集', 'dataset', 'export'),
    ('dataset.share', '分享数据集', 'dataset', 'share'),
    ('dataset.delete', '删除数据集', 'dataset', 'delete'),
    ('dataset.lock', '锁定数据集', 'dataset', 'lock'),
    ('share.view', '查看分享记录', 'share', 'view'),
    ('share.create', '创建分享', 'share', 'create'),
    ('share.revoke', '撤销分享', 'share', 'revoke'),
    ('audit.view', '查看审计日志', 'audit', 'view'),
    ('service_access.grant', '授权售后访问', 'service_access', 'grant')
ON CONFLICT (code) DO NOTHING;

WITH role_permission_seed (role_code, permission_codes) AS (
    VALUES
        ('owner', ARRAY[
            'member.manage', 'workspace.view', 'workspace.manage', 'project.view', 'project.manage',
            'site.view', 'site.manage', 'device.view', 'device.bind', 'device.configure',
            'device.calibrate', 'device.maintain', 'device.firmware_upgrade', 'device.unbind',
            'device.transfer', 'telemetry.view_realtime', 'telemetry.view_history', 'telemetry.export',
            'media.live_view', 'media.archive_view', 'media.download', 'media.delete', 'media.ptz_control',
            'dataset.view', 'dataset.create', 'dataset.export', 'dataset.share', 'dataset.delete',
            'dataset.lock', 'share.view', 'share.create', 'share.revoke', 'audit.view', 'service_access.grant'
        ]::text[]),
        ('admin', ARRAY[
            'member.manage', 'workspace.view', 'workspace.manage', 'project.view', 'project.manage',
            'site.view', 'site.manage', 'device.view', 'device.bind', 'device.configure',
            'device.calibrate', 'device.maintain', 'device.firmware_upgrade', 'device.unbind',
            'device.transfer', 'telemetry.view_realtime', 'telemetry.view_history', 'telemetry.export',
            'media.live_view', 'media.archive_view', 'media.download', 'media.delete', 'media.ptz_control',
            'dataset.view', 'dataset.create', 'dataset.export', 'dataset.share', 'dataset.delete',
            'dataset.lock', 'share.view', 'share.create', 'share.revoke', 'audit.view', 'service_access.grant'
        ]::text[]),
        ('project_manager', ARRAY[
            'workspace.view', 'project.view', 'project.manage', 'site.view', 'site.manage',
            'device.view', 'device.bind', 'device.configure', 'device.calibrate', 'device.maintain',
            'device.firmware_upgrade', 'telemetry.view_realtime', 'telemetry.view_history', 'telemetry.export',
            'media.live_view', 'media.archive_view', 'media.download', 'media.ptz_control',
            'dataset.view', 'dataset.create', 'dataset.export', 'dataset.share', 'dataset.lock',
            'share.view', 'share.create', 'share.revoke', 'service_access.grant'
        ]::text[]),
        ('site_operator', ARRAY[
            'workspace.view', 'project.view', 'site.view', 'site.manage', 'device.view',
            'device.configure', 'device.maintain', 'telemetry.view_realtime', 'telemetry.view_history',
            'media.live_view', 'media.archive_view', 'media.ptz_control', 'dataset.view'
        ]::text[]),
        ('data_manager', ARRAY[
            'workspace.view', 'project.view', 'site.view', 'device.view',
            'telemetry.view_realtime', 'telemetry.view_history', 'telemetry.export',
            'media.live_view', 'media.archive_view', 'media.download',
            'dataset.view', 'dataset.create', 'dataset.export', 'dataset.share', 'dataset.delete',
            'dataset.lock', 'share.view', 'share.create', 'share.revoke'
        ]::text[]),
        ('researcher', ARRAY[
            'workspace.view', 'project.view', 'site.view', 'device.view',
            'telemetry.view_realtime', 'telemetry.view_history', 'telemetry.export',
            'media.live_view', 'media.archive_view', 'dataset.view', 'dataset.export'
        ]::text[]),
        ('viewer', ARRAY[
            'workspace.view', 'project.view', 'site.view', 'device.view',
            'telemetry.view_realtime', 'telemetry.view_history',
            'media.live_view', 'media.archive_view', 'dataset.view'
        ]::text[]),
        ('shared_viewer', ARRAY[
            'project.view', 'site.view', 'device.view',
            'telemetry.view_realtime', 'telemetry.view_history',
            'media.live_view', 'media.archive_view', 'dataset.view'
        ]::text[]),
        ('shared_downloader', ARRAY[
            'project.view', 'site.view', 'device.view',
            'telemetry.view_realtime', 'telemetry.view_history', 'telemetry.export',
            'media.live_view', 'media.archive_view', 'media.download',
            'dataset.view', 'dataset.export'
        ]::text[]),
        ('service_engineer', ARRAY[
            'site.view', 'device.view', 'device.configure', 'device.calibrate',
            'device.maintain', 'device.firmware_upgrade', 'telemetry.view_realtime'
        ]::text[])
),
expanded AS (
    SELECT role_code, unnest(permission_codes) AS permission_code
    FROM role_permission_seed
)
INSERT INTO role_permissions (role_id, permission_id)
SELECT roles.id, permissions.id
FROM expanded
JOIN roles ON roles.code = expanded.role_code AND roles.workspace_id IS NULL
JOIN permissions ON permissions.code = expanded.permission_code
ON CONFLICT DO NOTHING;

-- Device capability catalog.

INSERT INTO device_capability_definitions (code, name, sort_order)
VALUES
    ('telemetry', '遥测', 10),
    ('image_capture', '图片采集', 20),
    ('video_stream', '视频流', 30),
    ('ptz_control', '云台控制', 40),
    ('remote_command', '远程命令', 50),
    ('configurable', '可配置', 60),
    ('calibratable', '可校准', 70),
    ('firmware_update', '固件升级', 80),
    ('edge_storage', '边缘存储', 90);

-- Device environment and research taxonomy.

INSERT INTO device_taxonomy_terms (kind, code, name_zh, name_en, sort_order, system_defined) VALUES
('ecosystem','forest','森林','Forest',10,true),
('ecosystem','grassland','草原','Grassland',20,true),
('ecosystem','cropland','农田','Cropland',30,true),
('ecosystem','wetland','湿地','Wetland',40,true),
('ecosystem','desert','荒漠','Desert',50,true),
('ecosystem','urban','城市','Urban',60,true),
('ecosystem','water','水域','Water',70,true),
('ecosystem','other','其他','Other',999,true),
('observation_object','atmosphere','大气','Atmosphere',10,true),
('observation_object','soil','土壤','Soil',20,true),
('observation_object','plant','植物','Plant',30,true),
('observation_object','tree','树木','Tree',40,true),
('observation_object','grassland_community','草地群落','Grassland community',50,true),
('observation_object','dust','沙尘','Dust',60,true),
('observation_object','water_body','水体','Water body',70,true),
('purpose','dust_monitoring','沙尘监测','Dust monitoring',10,true),
('purpose','tree_radial_growth','树木径向生长监测','Tree radial growth monitoring',20,true),
('purpose','plant_phenology','植物物候监测','Plant phenology monitoring',30,true),
('purpose','grassland_restoration','草原生态修复评估','Grassland restoration assessment',40,true),
('purpose','crop_growth','农作物生长监测','Crop growth monitoring',50,true),
('purpose','forest_ecology','森林生态监测','Forest ecology monitoring',60,true),
('purpose','soil_environment','土壤环境监测','Soil environment monitoring',70,true),
('purpose','microclimate','小气候监测','Microclimate monitoring',80,true),
('purpose','hydrology','水文监测','Hydrology monitoring',90,true),
('purpose','method_validation','设备与方法验证','Equipment and method validation',100,true),
('purpose','other','其他','Other',999,true),
('management','natural','天然','Natural',10,true),
('management','managed','人工','Managed',20,true),
('management','experimental','试验处理','Experimental treatment',30,true),
('deployment','outdoor','室外','Outdoor',10,true),
('deployment','greenhouse','温室','Greenhouse',20,true),
('deployment','indoor','室内','Indoor',30,true);

-- Development bootstrap account.
-- Platform and admin login: demo@thcpn.local / Thcpn123456
INSERT INTO users (
    id,
    name,
    email,
    status,
    email_verified_at
)
VALUES (
    '00000000-0000-4000-8000-000000000001',
    'THCPN 演示管理员',
    'demo@thcpn.local',
    'active',
    now()
);

INSERT INTO user_credentials (
    user_id,
    password_hash,
    must_change_password
)
VALUES (
    '00000000-0000-4000-8000-000000000001',
    '$2a$10$uOf3yKNbMHiAc8vjDZaVsuBv2Q/DtUI0bEqDlMTMcop2W8KARODt6',
    false
);

INSERT INTO workspaces (
    id,
    type,
    name,
    owner_user_id
)
VALUES (
    '00000000-0000-4000-8000-000000000101',
    'personal',
    'THCPN 演示管理员的工作区',
    '00000000-0000-4000-8000-000000000001'
);

INSERT INTO workspace_members (
    id,
    workspace_id,
    user_id,
    role_id,
    scope_type,
    scope_id,
    template_code
)
SELECT
    '00000000-0000-4000-8000-000000000201',
    '00000000-0000-4000-8000-000000000101',
    '00000000-0000-4000-8000-000000000001',
    roles.id,
    'workspace',
    '00000000-0000-4000-8000-000000000101',
    'owner'
FROM roles
WHERE roles.workspace_id IS NULL
  AND roles.code = 'owner';

INSERT INTO workspace_member_permissions (member_id, permission_id)
SELECT
    '00000000-0000-4000-8000-000000000201',
    role_permissions.permission_id
FROM roles
JOIN role_permissions ON role_permissions.role_id = roles.id
WHERE roles.workspace_id IS NULL
  AND roles.code = 'owner';

INSERT INTO system_admins (
    id,
    name,
    email,
    password_hash,
    status
)
VALUES (
    '00000000-0000-4000-8000-000000000301',
    'THCPN 演示管理员',
    'demo@thcpn.local',
    '$2a$10$uOf3yKNbMHiAc8vjDZaVsuBv2Q/DtUI0bEqDlMTMcop2W8KARODt6',
    'active'
);
