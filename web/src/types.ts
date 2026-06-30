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

export type OrganizationType =
  | "lab"
  | "institution"
  | "company"
  | "government"
  | "service_provider"
  | "other";

export type InternalMemberRoleCode =
  | "owner"
  | "admin"
  | "project_manager"
  | "site_operator"
  | "data_manager"
  | "researcher"
  | "viewer";

export interface UserProfile {
  id: string;
  name: string;
  phone?: string;
  email?: string;
  status: UserStatus;
  phone_verified_at?: string;
  email_verified_at?: string;
  last_login_at?: string;
}

export interface Actor {
  id: string;
  name: string;
  phone?: string;
  email?: string;
  status: UserStatus;
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

export interface MeResponse {
  user: Actor;
}

export interface User {
  id: string;
  name: string;
  phone?: string;
  email?: string;
  status: UserStatus;
  created_at: string;
  updated_at: string;
  phone_verified_at?: string;
  email_verified_at?: string;
  last_login_at?: string;
}

export interface Workspace {
  id: string;
  type: WorkspaceType;
  organization_type?: OrganizationType;
  name: string;
  owner_user_id: string;
  status: WorkspaceStatus;
  created_at: string;
  updated_at: string;
}

export interface RoleSummary {
  id: string;
  code: string;
  name: string;
}

export interface WorkspaceMembership {
  id: string;
  status: MembershipStatus;
  joined_at: string;
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
  id: string;
  name: string;
  phone?: string;
  email?: string;
  status: UserStatus;
}

export interface WorkspaceMember {
  id: string;
  workspace_id: string;
  status: MembershipStatus;
  joined_at: string;
  user: UserSummary;
  role: RoleSummary;
}

export interface WorkspaceMemberListResponse {
  items: WorkspaceMember[];
}

export interface AuthSession {
  id: string;
  user_agent?: string;
  client_ip?: string;
  expires_at: string;
  last_used_at?: string;
  created_at: string;
}

export interface AuthSessionListResponse {
  items: AuthSession[];
}

export interface DevRegisterResponse {
  user: User;
  workspace: Workspace;
  membership: {
    id: string;
    workspace_id: string;
    user_id: string;
    role_id: string;
    role_code: string;
    role_name: string;
    status: MembershipStatus;
    joined_at: string;
  };
}
