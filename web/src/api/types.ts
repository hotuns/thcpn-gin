export type UUID = string;
export type Timestamp = string;

export type ErrorCode =
  | "INVALID_ARGUMENT"
  | "UNAUTHORIZED"
  | "PERMISSION_DENIED"
  | "NOT_FOUND"
  | "CONFLICT"
  | "RATE_LIMITED"
  | "INTERNAL"
  | "SERVICE_UNAVAILABLE";

export interface ErrorEnvelope {
  error: {
    code: ErrorCode;
    message: string;
    request_id?: string;
  };
}

export interface StatusResponse {
  status: string;
}

export type UserStatus = "active" | "disabled";
export type WorkspaceStatus = "active" | "disabled";
export type MembershipStatus = "active" | "disabled" | "removed";
export type WorkspaceType = "personal" | "organization";
export type OrganizationType = "lab" | "institution" | "company" | "government" | "service_provider" | "other";
export type InternalMemberRoleCode =
  | "owner"
  | "admin"
  | "project_manager"
  | "site_operator"
  | "data_manager"
  | "researcher"
  | "viewer";

export interface UserProfile {
  id: UUID;
  name: string;
  phone?: string;
  email?: string;
  status: UserStatus;
  phone_verified_at?: Timestamp;
  email_verified_at?: Timestamp;
  last_login_at?: Timestamp;
}

export interface Actor {
  id: UUID;
  name: string;
  phone?: string;
  email?: string;
  status: UserStatus;
  phone_verified_at?: Timestamp;
  email_verified_at?: Timestamp;
}

export interface LoginResponse {
  access_token: string;
  refresh_token: string;
  token_type: "Bearer";
  expires_in: number;
  refresh_expires_in: number;
  user: UserProfile;
  created?: boolean;
}

export interface SendSmsResponse {
  sent: boolean;
  expires_in: number;
  cooldown_seconds: number;
}

export type SendCodeResponse = SendSmsResponse;

export interface VerifyEmailResponse {
  user: UserProfile;
}

export interface MFAStatusResponse {
  totp_enabled: boolean;
  totp_enabled_at?: Timestamp;
}

export interface TOTPSetupResponse {
  secret: string;
  otpauth_uri: string;
}

export interface MeResponse {
  user: Actor;
}

export interface User {
  id: UUID;
  name: string;
  phone?: string;
  email?: string;
  status: UserStatus;
  created_at: Timestamp;
  updated_at: Timestamp;
  phone_verified_at?: Timestamp;
  email_verified_at?: Timestamp;
  last_login_at?: Timestamp;
}

export interface Workspace {
  id: UUID;
  type: WorkspaceType;
  organization_type?: OrganizationType;
  name: string;
  owner_user_id: UUID;
  status: WorkspaceStatus;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface RoleSummary {
  id: UUID;
  code: string;
  name: string;
}

export interface WorkspaceMembership {
  id: UUID;
  status: MembershipStatus;
  joined_at: Timestamp;
  role: RoleSummary;
}

export interface WorkspaceWithMembership {
  workspace: Workspace;
  membership: WorkspaceMembership;
}

export interface WorkspaceListResponse {
  items: WorkspaceWithMembership[];
}

export interface UserSummary {
  id: UUID;
  name: string;
  phone?: string;
  email?: string;
  status: UserStatus;
}

export interface WorkspaceMember {
  id: UUID;
  workspace_id: UUID;
  status: MembershipStatus;
  joined_at: Timestamp;
  user: UserSummary;
  role: RoleSummary;
}

export interface WorkspaceMemberListResponse {
  items: WorkspaceMember[];
}

export interface AuthSession {
  id: UUID;
  user_agent?: string;
  client_ip?: string;
  expires_at: Timestamp;
  last_used_at?: Timestamp;
  created_at: Timestamp;
}

export interface AuthSessionListResponse {
  items: AuthSession[];
}

export interface DevRegisterResponse {
  user: User;
  workspace: Workspace;
  membership: {
    id: UUID;
    workspace_id: UUID;
    user_id: UUID;
    role_id: UUID;
    role_code: string;
    role_name: string;
    status: MembershipStatus;
    joined_at: Timestamp;
  };
}

export type ProjectStatus = "active" | "archived";
export type SiteStatus = "active" | "archived";
export type DeviceStatus = "active" | "disabled" | "retired";
export type DeviceCapabilityCode =
  | "telemetry"
  | "image_capture"
  | "video_stream"
  | "ptz_control"
  | "remote_command"
  | "configurable"
  | "calibratable"
  | "firmware_update"
  | "edge_storage";
export type DataStreamType = "telemetry" | "image" | "video" | "audio" | "event" | "log";
export type DataStreamStatus = "active" | "disabled" | "archived";
export type DataSourceType = "postgres" | "mysql" | "clickhouse" | "http_api" | "file";
export type DataSourceStatus = "active" | "disabled" | "archived";
export type DataStreamBindingPayloadType = "columns" | "json" | "media";
export type DataStreamBindingStatus = "active" | "disabled" | "archived";
export type DatasetDataType = "telemetry" | "image" | "video" | "audio" | "event" | "log" | "mixed";
export type DatasetStatus = "draft" | "locked" | "archived" | "published";
export type DatasetSourceType = "device" | "data_stream" | "file";
export type ExportResourceType = "device" | "data_stream" | "dataset" | "media";
export type ExportType = "telemetry_csv" | "telemetry_excel" | "media_zip" | "dataset_zip";
export type ExportStatus = "pending" | "running" | "success" | "failed" | "expired";
export type AccessGrantRoleCode =
  | "project_manager"
  | "site_operator"
  | "data_manager"
  | "researcher"
  | "viewer"
  | "shared_viewer"
  | "shared_downloader"
  | "service_engineer";
export type AccessGrantScopeType = "workspace" | "project" | "site" | "device" | "dataset";
export type AccessGrantStatus = "active" | "revoked" | "expired";
export type InvitationStatus = "pending" | "accepted" | "expired" | "revoked";
export type AuditActorType = "user" | "service_account" | "system" | "anonymous";
export type AuditResult = "success" | "failure";

export interface Project {
  id: UUID;
  workspace_id: UUID;
  name: string;
  description?: string;
  status: ProjectStatus;
  created_by: UUID;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface ProjectListResponse {
  items: Project[];
}

export interface Site {
  id: UUID;
  workspace_id: UUID;
  project_id: UUID;
  name: string;
  description?: string;
  location_text?: string;
  latitude?: number;
  longitude?: number;
  status: SiteStatus;
  created_by: UUID;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface SiteListResponse {
  items: Site[];
}

export interface Device {
  id: UUID;
  workspace_id: UUID;
  project_id?: UUID;
  site_id?: UUID;
  product_id?: string;
  serial_no: string;
  name: string;
  status: DeviceStatus;
  activated_at?: Timestamp;
  bound_by?: UUID;
  capabilities: DeviceCapabilityCode[];
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface DeviceListResponse {
  items: Device[];
}

export interface DataStream {
  id: UUID;
  workspace_id: UUID;
  device_id: UUID;
  code: string;
  name: string;
  type: DataStreamType;
  unit?: string;
  status: DataStreamStatus;
  created_by: UUID;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface DataStreamListResponse {
  items: DataStream[];
}

export interface DataSource {
  id: UUID;
  workspace_id: UUID;
  name: string;
  type: DataSourceType;
  dsn_secret_ref: string;
  status: DataSourceStatus;
  created_by: UUID;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface DataSourceListResponse {
  items: DataSource[];
}

export interface DataStreamBinding {
  id: UUID;
  data_stream_id: UUID;
  data_source_id: UUID;
  database_name?: string;
  schema_name?: string;
  table_name: string;
  device_key_field: string;
  device_key_value: string;
  time_field: string;
  value_field: string;
  payload_type: DataStreamBindingPayloadType;
  query_config: Record<string, unknown>;
  status: DataStreamBindingStatus;
  created_by: UUID;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface DataStreamBindingListResponse {
  items: DataStreamBinding[];
}

export interface DatasetSource {
  id: UUID;
  dataset_id: UUID;
  source_type: DatasetSourceType;
  source_id: UUID;
  created_at: Timestamp;
}

export interface DatasetSourceInput {
  source_type: DatasetSourceType;
  source_id: UUID;
}

export interface Dataset {
  id: UUID;
  workspace_id: UUID;
  project_id?: UUID;
  name: string;
  description?: string;
  data_type: DatasetDataType;
  time_start: Timestamp;
  time_end: Timestamp;
  status: DatasetStatus;
  created_by: UUID;
  sources: DatasetSource[];
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface DatasetListResponse {
  items: Dataset[];
}

export interface ExportJob {
  id: UUID;
  workspace_id: UUID;
  requested_by: UUID;
  resource_type: ExportResourceType;
  resource_id: UUID;
  export_type: ExportType;
  request_config?: Record<string, unknown>;
  status: ExportStatus;
  file_object_key?: string;
  error_message?: string;
  created_at: Timestamp;
  updated_at: Timestamp;
  started_at?: Timestamp;
  finished_at?: Timestamp;
  expires_at: Timestamp;
}

export interface ExportJobListResponse {
  items: ExportJob[];
}

export interface ExportDownloadResponse {
  export_job_id: UUID;
  url: string;
  expires_at: Timestamp;
}

export interface AccessGrantSubject {
  type: "user";
  id: UUID;
  name?: string;
  phone?: string;
  email?: string;
}

export interface AccessGrant {
  id: UUID;
  workspace_id: UUID;
  subject: AccessGrantSubject;
  role: RoleSummary;
  scope_type: AccessGrantScopeType;
  scope_id: UUID;
  expires_at?: Timestamp;
  allow_reshare: boolean;
  allow_api_access: boolean;
  created_by: UUID;
  status: AccessGrantStatus;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface AccessGrantListResponse {
  items: AccessGrant[];
}

export interface Invitation {
  id: UUID;
  workspace_id: UUID;
  invitee_email?: string;
  invitee_phone?: string;
  role: RoleSummary;
  scope_type: AccessGrantScopeType;
  scope_id: UUID;
  expires_at?: Timestamp;
  invited_by: UUID;
  status: InvitationStatus;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface InvitationListResponse {
  items: Invitation[];
}

export interface AuditLog {
  id: UUID;
  workspace_id?: UUID;
  actor_type: AuditActorType;
  actor_id?: UUID;
  action: string;
  resource_type: string;
  resource_id?: UUID;
  result: AuditResult;
  reason?: string;
  ip?: string;
  user_agent?: string;
  request_id?: string;
  created_at: Timestamp;
}

export interface AuditLogListResponse {
  items: AuditLog[];
}
