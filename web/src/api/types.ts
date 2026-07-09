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
export type MemberScopeType = "workspace" | "project" | "site" | "device" | "dataset";
export type PermissionCode = string;

export interface UserProfile {
  id: UUID;
  name: string;
  phone?: string;
  email?: string;
  status: UserStatus;
  is_system_admin: boolean;
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
  is_system_admin: boolean;
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
  is_system_admin?: boolean;
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
  scope_type: MemberScopeType;
  scope_id: UUID;
  role: RoleSummary;
}

export interface WorkspaceWithMembership {
  workspace: Workspace;
  membership: WorkspaceMembership;
}

export interface WorkspaceListResponse {
  items: WorkspaceWithMembership[];
}

export interface WorkspaceAdminListResponse {
  items: Workspace[];
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
  scope_type: MemberScopeType;
  scope_id: UUID;
  template_code: string;
  template_name: string;
  permission_codes: PermissionCode[];
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
    scope_type: MemberScopeType;
    scope_id: UUID;
  };
}

export type ProjectStatus = "active" | "archived";
export type SiteStatus = "active" | "archived";
export type DeviceStatus = "active" | "disabled" | "retired";
export type DeviceLifecycleStatus = "inbound" | "installed" | "online" | "maintenance" | "repairing" | "retired";
export type DeviceCapabilityCode = string;
export type DeviceCapabilityDefinitionStatus = "active" | "disabled";
export type DataStreamType = "telemetry" | "image" | "video" | "audio" | "event" | "log";
export type DataStreamStatus = "active" | "disabled" | "archived";
export type DataSourceType = "postgres" | "mysql" | "clickhouse" | "http_api" | "file";
export type DataSourceStatus = "active" | "disabled" | "archived";
export type DataStreamBindingPayloadType = "columns" | "json" | "media";
export type DataStreamBindingAdapterCode = "generic_columns" | "generic_media" | "http_api" | "thcpn_legacy_mysql";
export type DataStreamBindingStatus = "active" | "disabled" | "archived";
export type DeviceRelationStatus = "active" | "removed";
export type DeviceRelationType = "gateway_node";
export type DeviceTopologyRole = "standalone" | "gateway" | "gateway_node" | "camera";
export type CameraProvider = "ezviz";
export type CameraQuality = "fluent" | "standard" | "hd" | "ultra_hd";
export type CameraBindingStatus = "active" | "disabled";
export type MediaType = "image" | "video" | "audio";
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

export interface PermissionDefinition {
  code: PermissionCode;
  name: string;
  resource_type: string;
  action: string;
  group: string;
}

export interface PermissionGroup {
  code: string;
  name: string;
  codes: PermissionCode[];
}

export interface PermissionTemplate {
  code: string;
  name: string;
  permission_codes: PermissionCode[];
}

export interface PermissionCatalogResponse {
  permissions: PermissionDefinition[];
  groups: PermissionGroup[];
  templates: PermissionTemplate[];
}

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
  assignment_id?: UUID;
  workspace_id?: UUID;
  project_id?: UUID;
  site_id?: UUID;
  product_id?: string;
  serial_no: string;
  name: string;
  status: DeviceStatus;
  activated_at?: Timestamp;
  lifecycle_status: DeviceLifecycleStatus;
  lifecycle_updated_at?: Timestamp;
  device_type: DeviceTopologyRole;
  assigned_by?: UUID;
  assigned_at?: Timestamp;
  capabilities: DeviceCapabilityCode[];
  topology_role: DeviceTopologyRole;
  child_count: number;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface DeviceListResponse {
  items: Device[];
}

export interface CameraBinding {
  id: UUID;
  device_id: UUID;
  provider: CameraProvider;
  device_serial: string;
  channel_no: number;
  default_quality: CameraQuality;
  is_encrypted: boolean;
  validate_code_secret_ref?: string;
  status: CameraBindingStatus;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface Camera {
  device: Device;
  binding: CameraBinding;
}

export interface CameraLiveSessionResponse {
  provider: CameraProvider;
  access_token: string;
  url: string;
  quality: CameraQuality;
  expires_at: Timestamp;
  device_serial: string;
  channel_no: number;
}

export interface DeviceLifecycleEvent {
  id: UUID;
  device_id: UUID;
  from_status?: DeviceLifecycleStatus;
  to_status: DeviceLifecycleStatus;
  occurred_at: Timestamp;
  note?: string;
  actor_user_id?: UUID;
  created_at: Timestamp;
}

export interface DeviceLifecycleResponse {
  device: Device;
  events: DeviceLifecycleEvent[];
}

export interface DeviceCapabilityDefinition {
  code: string;
  name: string;
  status: DeviceCapabilityDefinitionStatus;
  sort_order: number;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface DeviceCapabilityDefinitionListResponse {
  items: DeviceCapabilityDefinition[];
}

export interface SystemRoleDefinition {
  id: UUID;
  code: string;
  name: string;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface SystemRoleDefinitionListResponse {
  items: SystemRoleDefinition[];
}

export interface DeviceCapabilitiesResponse {
  capabilities: DeviceCapabilityCode[];
}

export interface DeviceRelation {
  id: UUID;
  parent_device_id: UUID;
  child_device_id: UUID;
  relation_type: DeviceRelationType;
  data_source_id: UUID;
  external_parent_device_id: number;
  external_child_device_id: number;
  status: DeviceRelationStatus;
  synced_at: Timestamp;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface DeviceChild {
  relation: DeviceRelation;
  device: Device;
}

export interface DeviceChildrenResponse {
  items: DeviceChild[];
}

export interface DataStream {
  id: UUID;
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

export interface QueryWarning {
  code: string;
  message: string;
  count?: number;
}

export interface TelemetryPoint {
  ts: Timestamp;
  value: number;
  quality: string;
}

export interface TelemetrySeries {
  data_stream_id: UUID;
  code: string;
  name: string;
  unit?: string;
  points: TelemetryPoint[];
  warnings?: QueryWarning[];
}

export interface TelemetryQueryResponse {
  device_id: UUID;
  start_time: Timestamp;
  end_time: Timestamp;
  limit: number;
  series: TelemetrySeries[];
}

export interface MediaItem {
  id: string;
  device_id: UUID;
  data_stream_id: UUID;
  captured_at: Timestamp;
  media_type: MediaType;
  thumbnail_url?: string;
  preview_url: string;
  download_allowed: boolean;
  download_url?: string;
  delete_allowed: boolean;
  delete_url?: string;
}

export interface MediaListResponse {
  items: MediaItem[];
  page: number;
  page_size: number;
  total: number;
}

export interface DataSource {
  id: UUID;
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

export interface SyncedDevice {
  id: UUID;
  assignment_id?: UUID;
  workspace_id?: UUID;
  project_id?: UUID;
  site_id?: UUID;
  product_id?: string;
  serial_no: string;
  name: string;
  status: DeviceStatus;
  device_type: DeviceTopologyRole;
  assigned_by?: UUID;
  assigned_at?: Timestamp;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface SyncedDataStream {
  id: UUID;
  device_id: UUID;
  code: string;
  name: string;
  type: DataStreamType;
  unit?: string;
  status: DataStreamStatus;
}

export interface DeviceSourceRef {
  id: UUID;
  device_id: UUID;
  data_source_id: UUID;
  adapter_code: DataStreamBindingAdapterCode;
  external_device_id: number;
  external_sn?: string;
  external_uuid?: string;
  external_device_type?: string;
  status: DataStreamBindingStatus;
  synced_at: Timestamp;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface DeviceConfigSnapshot {
  id: UUID;
  device_id: UUID;
  data_source_id: UUID;
  adapter_code: DataStreamBindingAdapterCode;
  external_device_id: number;
  external_config_id: number;
  version?: string;
  data_json: Record<string, unknown>[];
  image_json: Record<string, unknown>[];
  control_json: Record<string, unknown>;
  source_created_at?: Timestamp;
  source_updated_at?: Timestamp;
  synced_at: Timestamp;
  created_at: Timestamp;
}

export interface THCPNExternalDeviceMetadata {
  id: number;
  name: string;
  iccid?: string;
  version?: string;
  status?: string;
  device_type?: string;
  active?: number;
  sn?: string;
  uuid?: string;
  current_device_version?: string;
  created_at?: Timestamp;
  updated_at?: Timestamp;
}

export interface SyncTHCPNStandardStationRequest {
  target_workspace_id?: UUID;
  external_device_id: number;
  project_id?: UUID;
  site_id?: UUID;
  product_id?: string;
  serial_no?: string;
  name?: string;
}

export interface SyncTHCPNGatewayRequest {
  target_workspace_id?: UUID;
  external_gateway_id: number;
  project_id?: UUID;
  site_id?: UUID;
  assign_nodes?: boolean;
  product_id?: string;
  serial_no?: string;
  name?: string;
}

export interface THCPNStandardStationSyncResult {
  device: SyncedDevice;
  source_ref: DeviceSourceRef;
  config_snapshot: DeviceConfigSnapshot;
  data_streams: SyncedDataStream[];
  bindings: DataStreamBinding[];
  external_device: THCPNExternalDeviceMetadata;
}

export interface THCPNGatewaySyncResult {
  gateway: THCPNStandardStationSyncResult;
  nodes: THCPNStandardStationSyncResult[];
  relations: DeviceRelation[];
  removed_relations?: DeviceRelation[];
  warnings?: QueryWarning[];
}

export interface DataStreamBinding {
  id: UUID;
  data_stream_id: UUID;
  data_source_id: UUID;
  adapter_code: DataStreamBindingAdapterCode;
  database_name?: string;
  schema_name?: string;
  table_name?: string;
  device_key_field?: string;
  device_key_value?: string;
  time_field?: string;
  value_field?: string;
  payload_type: DataStreamBindingPayloadType;
  adapter_config: Record<string, unknown>;
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

export interface DatasetTelemetrySeries {
  source_type: DatasetSourceType;
  source_id: UUID;
  data_stream_id: UUID;
  device_id: UUID;
  code: string;
  name: string;
  unit?: string;
  points: TelemetryPoint[];
  warnings?: QueryWarning[];
}

export interface DatasetTelemetryQueryResponse {
  dataset_id: UUID;
  workspace_id: UUID;
  start_time: Timestamp;
  end_time: Timestamp;
  limit: number;
  series: DatasetTelemetrySeries[];
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
  template_code: string;
  template_name: string;
  permission_codes: PermissionCode[];
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
  template_code: string;
  template_name: string;
  permission_codes: PermissionCode[];
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
