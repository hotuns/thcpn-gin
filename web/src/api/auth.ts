import { del, get, post } from "./client";
import type {
  AuthSessionListResponse,
  DevRegisterResponse,
  LoginResponse,
  MFAStatusResponse,
  MeResponse,
  SendCodeResponse,
  SendSmsResponse,
  TOTPSetupResponse,
  VerifyEmailResponse
} from "./types";

export const authApi = {
  sendSms(phone: string): Promise<SendSmsResponse> {
    return post<SendSmsResponse>("/api/v1/auth/sms/send", { phone });
  },

  loginWithSms(input: { phone: string; code: string; mfa_code?: string; name?: string }): Promise<LoginResponse> {
    return post<LoginResponse>("/api/v1/auth/sms/login", input);
  },

  registerWithPassword(input: {
    name: string;
    phone?: string;
    email?: string;
    password: string;
  }): Promise<LoginResponse> {
    return post<LoginResponse>("/api/v1/auth/password/register", input);
  },

  loginWithPassword(input: { identifier: string; password: string; mfa_code?: string }): Promise<LoginResponse> {
    return post<LoginResponse>("/api/v1/auth/password/login", input);
  },

  refreshAuth(refreshToken: string): Promise<LoginResponse> {
    return post<LoginResponse>("/api/v1/auth/refresh", { refresh_token: refreshToken });
  },

  logout(refreshToken?: string): Promise<void> {
    return post<void>("/api/v1/auth/logout", refreshToken ? { refresh_token: refreshToken } : {});
  },

  listSessions(): Promise<AuthSessionListResponse> {
    return get<AuthSessionListResponse>("/api/v1/auth/sessions");
  },

  revokeSession(sessionId: string): Promise<void> {
    return del<void>(`/api/v1/auth/sessions/${sessionId}`);
  },

  sendEmailVerification(email: string): Promise<SendCodeResponse> {
    return post<SendCodeResponse>("/api/v1/auth/email/send", { email });
  },

  verifyEmail(input: { email: string; code: string }): Promise<VerifyEmailResponse> {
    return post<VerifyEmailResponse>("/api/v1/auth/email/verify", input);
  },

  mfaStatus(): Promise<MFAStatusResponse> {
    return get<MFAStatusResponse>("/api/v1/auth/mfa");
  },

  setupTOTP(): Promise<TOTPSetupResponse> {
    return post<TOTPSetupResponse>("/api/v1/auth/mfa/totp/setup", {});
  },

  enableTOTP(code: string): Promise<MFAStatusResponse> {
    return post<MFAStatusResponse>("/api/v1/auth/mfa/totp/enable", { code });
  },

  disableTOTP(code: string): Promise<void> {
    return del<void>("/api/v1/auth/mfa/totp", { code });
  },

  me(): Promise<MeResponse> {
    return get<MeResponse>("/api/v1/me");
  },

  devRegister(input: { name: string; phone: string; email: string }): Promise<DevRegisterResponse> {
    return post<DevRegisterResponse>("/api/v1/auth/register", input);
  }
};
