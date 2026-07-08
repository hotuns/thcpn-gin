import { useEffect, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { KeyRound, MailCheck, RefreshCcw, ShieldOff, Smartphone, Trash2 } from "lucide-react";
import { Alert, App as AntApp, Button, Form, Input, Result, Space, Spin, Table, Tag } from "antd";
import type { TableColumnsType } from "antd";
import { authApi, formatApiError, type AuthSession } from "../../api";
import { useAuth } from "../../app/AuthProvider";
import { formatDateTime } from "../../app/format";
import { Page, Section } from "../../components";
import { copyableId, tableScrollX } from "../../app/ui";

export function SecurityPage() {
  const [emailForm, setEmailForm] = useState({ email: "", code: "" });
  const [mfaCode, setMfaCode] = useState("");
  const [totpSecret, setTotpSecret] = useState<{ secret: string; otpauth_uri: string } | null>(null);
  const { refreshAccessToken, refreshToken } = useAuth();
  const queryClient = useQueryClient();
  const { message } = AntApp.useApp();

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
    onSuccess: (result) => void message.info(`邮箱验证码已发送，有效期 ${result.expires_in} 秒`)
  });

  const verifyEmail = useMutation({
    mutationFn: authApi.verifyEmail,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["me"] });
      void message.success("邮箱已验证");
    }
  });

  const setupTotp = useMutation({
    mutationFn: authApi.setupTOTP,
    onSuccess: (result) => {
      setTotpSecret(result);
      void message.info("TOTP secret 已生成");
    }
  });

  const enableTotp = useMutation({
    mutationFn: authApi.enableTOTP,
    onSuccess: () => {
      setTotpSecret(null);
      setMfaCode("");
      void queryClient.invalidateQueries({ queryKey: ["mfa"] });
      void message.success("TOTP 已启用");
    }
  });

  const disableTotp = useMutation({
    mutationFn: authApi.disableTOTP,
    onSuccess: () => {
      setMfaCode("");
      void queryClient.invalidateQueries({ queryKey: ["mfa"] });
      void message.success("TOTP 已禁用");
    }
  });

  const refreshTokenMutation = useMutation({
    mutationFn: refreshAccessToken,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["auth-sessions"] });
      void message.success("access token 已刷新");
    }
  });

  const revokeSession = useMutation({
    mutationFn: (session: AuthSession) => authApi.revokeSession(session.id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["auth-sessions"] });
      void message.success("会话已撤销");
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

  const sessionColumns: TableColumnsType<AuthSession> = [
    { key: "client", title: "客户端", width: 220, render: (_, session) => session.user_agent || "-" },
    { key: "ip", title: "IP", width: 150, render: (_, session) => session.client_ip || "-" },
    { key: "last", title: "最近使用", width: 180, render: (_, session) => formatDateTime(session.last_used_at) },
    { key: "created", title: "创建时间", width: 180, render: (_, session) => formatDateTime(session.created_at) },
    { key: "expires", title: "过期时间", width: 180, render: (_, session) => formatDateTime(session.expires_at) },
    { key: "id", title: "ID", width: 240, render: (_, session) => copyableId(session.id) },
    {
      key: "action",
      title: "操作",
      width: 130,
      render: (_, session) => (
        <Button
          danger
          disabled={revokeSession.isPending}
          icon={<Trash2 size={15} />}
          onClick={() => revokeSession.mutate(session)}
        >
          撤销
        </Button>
      )
    }
  ];

  return (
    <Page description="管理个人账号验证、多因素认证和当前 refresh session；工作区权限在成员权限和资源授权中配置。" title="账号安全">
      <div className="metric-grid">
        <div className="metric-card">
          <span>邮箱状态</span>
          <strong>{me.data?.user.email_verified_at ? "已验证" : "未验证"}</strong>
        </div>
        <div className="metric-card">
          <span>TOTP</span>
          <strong>{mfa.data?.totp_enabled ? "已启用" : "未启用"}</strong>
        </div>
        <div className="metric-card">
          <span>Refresh Token</span>
          <strong>{refreshToken ? "已保存" : "无"}</strong>
        </div>
      </div>

      <Section description="用于接收邀请和账号通知。" title="邮箱验证">
        <div className="dual-form-grid">
          <form className="form-stack" onSubmit={handleSendEmail}>
            <Form.Item className="field" label="邮箱" required>
              <Input
                className="control"
                onChange={(event) => setEmailForm({ ...emailForm, email: event.target.value })}
                required
                type="email"
                value={emailForm.email}
              />
            </Form.Item>
            <Button disabled={sendEmail.isPending} htmlType="submit" icon={<MailCheck size={16} />}>
              发送验证码
            </Button>
          </form>
          <form className="form-stack" onSubmit={handleVerifyEmail}>
            <Form.Item className="field" label="验证码" required>
              <Input
                className="control"
                inputMode="numeric"
                maxLength={6}
                onChange={(event) => setEmailForm({ ...emailForm, code: event.target.value })}
                required
                value={emailForm.code}
              />
            </Form.Item>
            <Button disabled={verifyEmail.isPending} htmlType="submit" icon={<MailCheck size={16} />} type="primary">
              验证邮箱
            </Button>
          </form>
        </div>
        {sendEmail.error || verifyEmail.error ? (
          <p className="form-error">{formatApiError(sendEmail.error || verifyEmail.error)}</p>
        ) : null}
      </Section>

      <Section description="认证器 App 扫描 otpauth URI 后，提交 6 位验证码启用。" title="多因素认证">
        {mfa.isLoading ? (
          <Space className="state state-inline">
            <Spin size="small" />
            <span>正在加载</span>
          </Space>
        ) : null}
        {mfa.error ? (
          <Result
            className="state state-error"
            extra={<Button onClick={() => void mfa.refetch()}>重试</Button>}
            status="warning"
            subTitle={<Alert message={formatApiError(mfa.error)} showIcon type="error" />}
            title="请求未完成"
          />
        ) : null}
        <div className="security-actions">
          <Tag color={mfa.data?.totp_enabled ? "success" : "warning"}>
            {mfa.data?.totp_enabled ? "TOTP enabled" : "TOTP disabled"}
          </Tag>
          <Button disabled={setupTotp.isPending} icon={<Smartphone size={16} />} onClick={() => setupTotp.mutate()}>
            生成 Secret
          </Button>
        </div>
        {totpSecret ? (
          <div className="secret-box">
            {copyableId(totpSecret.secret)}
            <p className="mono">{totpSecret.otpauth_uri}</p>
          </div>
        ) : null}
        <div className="dual-form-grid">
          <form className="form-stack" onSubmit={(event) => {
            event.preventDefault();
            enableTotp.mutate(mfaCode.trim());
          }}>
            <Form.Item className="field" label="TOTP 验证码" required>
              <Input
                className="control"
                inputMode="numeric"
                maxLength={6}
                onChange={(event) => setMfaCode(event.target.value)}
                required
                value={mfaCode}
              />
            </Form.Item>
            <Button disabled={enableTotp.isPending} htmlType="submit" icon={<KeyRound size={16} />} type="primary">
              启用
            </Button>
          </form>
          <form className="form-stack" onSubmit={(event) => {
            event.preventDefault();
            disableTotp.mutate(mfaCode.trim());
          }}>
            <Form.Item className="field" label="TOTP 验证码" required>
              <Input
                className="control"
                inputMode="numeric"
                maxLength={6}
                onChange={(event) => setMfaCode(event.target.value)}
                required
                value={mfaCode}
              />
            </Form.Item>
            <Button
              danger
              disabled={disableTotp.isPending || !mfa.data?.totp_enabled}
              htmlType="submit"
              icon={<ShieldOff size={16} />}
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
        {sessions.isLoading ? (
          <Space className="state state-inline">
            <Spin size="small" />
            <span>正在加载</span>
          </Space>
        ) : null}
        {sessions.error ? (
          <Result
            className="state state-error"
            extra={<Button onClick={() => void sessions.refetch()}>重试</Button>}
            status="warning"
            subTitle={<Alert message={formatApiError(sessions.error)} showIcon type="error" />}
            title="请求未完成"
          />
        ) : null}
        {sessions.data ? (
          <Table<AuthSession>
            className="data-table"
            columns={sessionColumns}
            dataSource={sessions.data.items}
            locale={{ emptyText: "暂无活跃会话" }}
            pagination={false}
            rowKey={(session) => session.id}
            scroll={{ x: tableScrollX(sessionColumns) }}
            size="middle"
            tableLayout="fixed"
          />
        ) : null}
      </Section>
    </Page>
  );
}
