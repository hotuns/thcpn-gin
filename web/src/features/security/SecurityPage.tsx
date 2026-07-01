import { useEffect, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { KeyRound, MailCheck, RefreshCcw, ShieldOff, Smartphone, Trash2 } from "lucide-react";
import { authApi, formatApiError, type AuthSession } from "../../api";
import { useAuth } from "../../app/AuthProvider";
import { formatDateTime } from "../../app/format";
import {
  Badge,
  Button,
  CopyableId,
  DataTable,
  ErrorState,
  LoadingState,
  Page,
  Section,
  TextInput,
  useToast
} from "../../components";

export function SecurityPage() {
  const [emailForm, setEmailForm] = useState({ email: "", code: "" });
  const [mfaCode, setMfaCode] = useState("");
  const [totpSecret, setTotpSecret] = useState<{ secret: string; otpauth_uri: string } | null>(null);
  const { refreshAccessToken, refreshToken } = useAuth();
  const queryClient = useQueryClient();
  const { pushToast } = useToast();

  const me = useQuery({ queryKey: ["me"], queryFn: authApi.me });
  const mfa = useQuery({ queryKey: ["mfa"], queryFn: authApi.mfaStatus });
  const sessions = useQuery({ queryKey: ["auth-sessions"], queryFn: authApi.listSessions });

  useEffect(() => {
    if (me.data?.user.email && !emailForm.email) {
      setEmailForm((current) => ({ ...current, email: me.data.user.email || current.email }));
    }
  }, [emailForm.email, me.data?.user.email]);

  const sendEmail = useMutation({
    mutationFn: authApi.sendEmailVerification,
    onSuccess: (result) => pushToast(`邮箱验证码已发送，有效期 ${result.expires_in} 秒`, "info")
  });

  const verifyEmail = useMutation({
    mutationFn: authApi.verifyEmail,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["me"] });
      pushToast("邮箱已验证");
    }
  });

  const setupTotp = useMutation({
    mutationFn: authApi.setupTOTP,
    onSuccess: (result) => {
      setTotpSecret(result);
      pushToast("TOTP secret 已生成", "info");
    }
  });

  const enableTotp = useMutation({
    mutationFn: authApi.enableTOTP,
    onSuccess: () => {
      setTotpSecret(null);
      setMfaCode("");
      void queryClient.invalidateQueries({ queryKey: ["mfa"] });
      pushToast("TOTP 已启用");
    }
  });

  const disableTotp = useMutation({
    mutationFn: authApi.disableTOTP,
    onSuccess: () => {
      setMfaCode("");
      void queryClient.invalidateQueries({ queryKey: ["mfa"] });
      pushToast("TOTP 已禁用");
    }
  });

  const refreshTokenMutation = useMutation({
    mutationFn: refreshAccessToken,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["auth-sessions"] });
      pushToast("access token 已刷新");
    }
  });

  const revokeSession = useMutation({
    mutationFn: (session: AuthSession) => authApi.revokeSession(session.id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["auth-sessions"] });
      pushToast("会话已撤销");
    }
  });

  function handleSendEmail(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    sendEmail.mutate(emailForm.email.trim());
  }

  function handleVerifyEmail(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    verifyEmail.mutate({ email: emailForm.email.trim(), code: emailForm.code.trim() });
  }

  return (
    <Page description="管理账号验证、多因素认证和当前 refresh session。" title="安全">
      <div className="metric-grid">
        <div className="metric-card">
          <span>邮箱状态</span>
          <strong>{me.data?.user.email_verified_at ? "已验证" : "未验证"}</strong>
          <small>{formatDateTime(me.data?.user.email_verified_at)}</small>
        </div>
        <div className="metric-card">
          <span>TOTP</span>
          <strong>{mfa.data?.totp_enabled ? "已启用" : "未启用"}</strong>
          <small>{formatDateTime(mfa.data?.totp_enabled_at)}</small>
        </div>
        <div className="metric-card">
          <span>Refresh Token</span>
          <strong>{refreshToken ? "已保存" : "无"}</strong>
          <small>本机浏览器会话</small>
        </div>
      </div>

      <Section description="用于接收邀请和账号通知。" title="邮箱验证">
        <div className="dual-form-grid">
          <form className="form-stack" onSubmit={handleSendEmail}>
            <TextInput
              label="邮箱"
              onChange={(event) => setEmailForm({ ...emailForm, email: event.target.value })}
              required
              type="email"
              value={emailForm.email}
            />
            <Button disabled={sendEmail.isPending} icon={<MailCheck size={16} />} type="submit">
              发送验证码
            </Button>
          </form>
          <form className="form-stack" onSubmit={handleVerifyEmail}>
            <TextInput
              inputMode="numeric"
              label="验证码"
              maxLength={6}
              onChange={(event) => setEmailForm({ ...emailForm, code: event.target.value })}
              required
              value={emailForm.code}
            />
            <Button disabled={verifyEmail.isPending} icon={<MailCheck size={16} />} type="submit" variant="primary">
              验证邮箱
            </Button>
          </form>
        </div>
        {sendEmail.error || verifyEmail.error ? (
          <p className="form-error">{formatApiError(sendEmail.error || verifyEmail.error)}</p>
        ) : null}
      </Section>

      <Section description="认证器 App 扫描 otpauth URI 后，提交 6 位验证码启用。" title="多因素认证">
        {mfa.isLoading ? <LoadingState /> : null}
        {mfa.error ? <ErrorState error={mfa.error} onRetry={() => void mfa.refetch()} /> : null}
        <div className="security-actions">
          <Badge tone={mfa.data?.totp_enabled ? "success" : "warning"}>
            {mfa.data?.totp_enabled ? "TOTP enabled" : "TOTP disabled"}
          </Badge>
          <Button disabled={setupTotp.isPending} icon={<Smartphone size={16} />} onClick={() => setupTotp.mutate()}>
            生成 Secret
          </Button>
        </div>
        {totpSecret ? (
          <div className="secret-box">
            <CopyableId value={totpSecret.secret} />
            <p className="mono">{totpSecret.otpauth_uri}</p>
          </div>
        ) : null}
        <div className="dual-form-grid">
          <form className="form-stack" onSubmit={(event) => {
            event.preventDefault();
            enableTotp.mutate(mfaCode.trim());
          }}>
            <TextInput
              inputMode="numeric"
              label="TOTP 验证码"
              maxLength={6}
              onChange={(event) => setMfaCode(event.target.value)}
              required
              value={mfaCode}
            />
            <Button disabled={enableTotp.isPending} icon={<KeyRound size={16} />} type="submit" variant="primary">
              启用
            </Button>
          </form>
          <form className="form-stack" onSubmit={(event) => {
            event.preventDefault();
            disableTotp.mutate(mfaCode.trim());
          }}>
            <TextInput
              inputMode="numeric"
              label="TOTP 验证码"
              maxLength={6}
              onChange={(event) => setMfaCode(event.target.value)}
              required
              value={mfaCode}
            />
            <Button
              disabled={disableTotp.isPending || !mfa.data?.totp_enabled}
              icon={<ShieldOff size={16} />}
              type="submit"
              variant="danger"
            >
              禁用
            </Button>
          </form>
        </div>
        {setupTotp.error || enableTotp.error || disableTotp.error ? (
          <p className="form-error">{formatApiError(setupTotp.error || enableTotp.error || disableTotp.error)}</p>
        ) : null}
      </Section>

      <Section
        actions={
          <Button
            disabled={refreshTokenMutation.isPending || !refreshToken}
            icon={<RefreshCcw size={16} />}
            onClick={() => refreshTokenMutation.mutate()}
          >
            刷新 Token
          </Button>
        }
        title="活跃会话"
      >
        {sessions.isLoading ? <LoadingState /> : null}
        {sessions.error ? <ErrorState error={sessions.error} onRetry={() => void sessions.refetch()} /> : null}
        {sessions.data ? (
          <DataTable<AuthSession>
            columns={[
              { key: "client", header: "客户端", render: (session) => session.user_agent || "-" },
              { key: "ip", header: "IP", render: (session) => session.client_ip || "-" },
              { key: "last", header: "最近使用", render: (session) => formatDateTime(session.last_used_at) },
              { key: "created", header: "创建时间", render: (session) => formatDateTime(session.created_at) },
              { key: "expires", header: "过期时间", render: (session) => formatDateTime(session.expires_at) },
              { key: "id", header: "ID", render: (session) => <CopyableId value={session.id} /> },
              {
                key: "action",
                header: "操作",
                render: (session) => (
                  <Button
                    disabled={revokeSession.isPending}
                    icon={<Trash2 size={15} />}
                    onClick={() => revokeSession.mutate(session)}
                    variant="danger"
                  >
                    撤销
                  </Button>
                )
              }
            ]}
            empty="暂无活跃会话"
            getRowKey={(session) => session.id}
            items={sessions.data.items}
          />
        ) : null}
      </Section>
    </Page>
  );
}
