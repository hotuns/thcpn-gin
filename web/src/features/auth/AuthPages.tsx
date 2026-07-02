import { Link, useLocation, useNavigate } from "react-router-dom";
import { useMutation } from "@tanstack/react-query";
import { LockOutlined, MessageOutlined, SafetyCertificateOutlined, UserAddOutlined } from "@ant-design/icons";
import { Alert, App as AntApp, Button, Card, Form, Input, Space, Tabs, Typography } from "antd";
import { useState, type ReactNode } from "react";
import { authApi, formatApiError } from "../../api";
import { useAuth } from "../../app/AuthProvider";
import { landingPathForUser } from "../../app/RouteGuards";

type LoginMode = "password" | "sms";

interface PasswordLoginForm {
  identifier: string;
  password: string;
  mfa_code?: string;
}

interface SmsLoginForm {
  phone: string;
  code: string;
  mfa_code?: string;
  name?: string;
}

interface RegisterForm {
  name: string;
  phone?: string;
  email?: string;
  password: string;
}

export function LoginPage() {
  const [mode, setMode] = useState<LoginMode>("password");
  const [smsForm] = Form.useForm<SmsLoginForm>();
  const { applyLogin } = useAuth();
  const { message } = AntApp.useApp();
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: { pathname?: string } } | null)?.from?.pathname;

  const passwordLogin = useMutation({
    mutationFn: authApi.loginWithPassword,
    onSuccess: (result) => {
      applyLogin(result);
      void message.success("登录成功");
      navigate(from || landingPathForUser(result.user), { replace: true });
    }
  });

  const sendSms = useMutation({
    mutationFn: authApi.sendSms,
    onSuccess: (result) => void message.info(`验证码已发送，有效期 ${result.expires_in} 秒`)
  });

  const smsLogin = useMutation({
    mutationFn: authApi.loginWithSms,
    onSuccess: (result) => {
      applyLogin(result);
      void message.success(result.created ? "账号已创建并登录" : "登录成功");
      navigate(from || landingPathForUser(result.user), { replace: true });
    }
  });

  const activeError = passwordLogin.error || sendSms.error || smsLogin.error;

  async function handleSendSms() {
    const values = await smsForm.validateFields(["phone"]);
    sendSms.mutate(values.phone.trim());
  }

  return (
    <AuthFrame
      aside="多工作区、设备、数据集和共享授权集中管理。"
      subtitle="登录后进入 THCPN 研究控制台。"
      title="登录"
    >
      <Tabs
        activeKey={mode}
        items={[
          {
            key: "password",
            label: "密码",
            children: (
              <Form<PasswordLoginForm>
                layout="vertical"
                onFinish={(values) =>
                  passwordLogin.mutate({
                    identifier: values.identifier.trim(),
                    password: values.password,
                    mfa_code: values.mfa_code?.trim() || undefined
                  })
                }
              >
                <Form.Item label="手机号或邮箱" name="identifier" rules={[{ required: true, message: "请输入手机号或邮箱" }]}>
                  <Input autoComplete="username" />
                </Form.Item>
                <Form.Item label="密码" name="password" rules={[{ required: true, message: "请输入密码" }]}>
                  <Input.Password autoComplete="current-password" />
                </Form.Item>
                <Form.Item label="MFA 码" name="mfa_code">
                  <Input inputMode="numeric" maxLength={6} />
                </Form.Item>
                <Button block htmlType="submit" icon={<LockOutlined />} loading={passwordLogin.isPending} type="primary">
                  登录
                </Button>
              </Form>
            )
          },
          {
            key: "sms",
            label: "短信",
            children: (
              <Form<SmsLoginForm>
                form={smsForm}
                layout="vertical"
                onFinish={(values) =>
                  smsLogin.mutate({
                    phone: values.phone.trim(),
                    code: values.code.trim(),
                    mfa_code: values.mfa_code?.trim() || undefined,
                    name: values.name?.trim() || undefined
                  })
                }
              >
                <Form.Item label="手机号" name="phone" rules={[{ required: true, message: "请输入手机号" }]}>
                  <Input autoComplete="tel" />
                </Form.Item>
                <Button block icon={<MessageOutlined />} loading={sendSms.isPending} onClick={handleSendSms}>
                  发送验证码
                </Button>
                <Form.Item label="验证码" name="code" rules={[{ required: true, message: "请输入验证码" }]}>
                  <Input inputMode="numeric" maxLength={6} />
                </Form.Item>
                <Form.Item label="MFA 码" name="mfa_code">
                  <Input inputMode="numeric" maxLength={6} />
                </Form.Item>
                <Form.Item label="新账号名称" name="name">
                  <Input />
                </Form.Item>
                <Button block htmlType="submit" icon={<SafetyCertificateOutlined />} loading={smsLogin.isPending} type="primary">
                  短信登录
                </Button>
              </Form>
            )
          }
        ]}
        onChange={(key) => setMode(key as LoginMode)}
      />

      {activeError ? <Alert message={formatApiError(activeError)} showIcon type="error" /> : null}
      <Typography.Paragraph className="auth-switch" type="secondary">
        没有账号？ <Link to="/register">注册</Link>
      </Typography.Paragraph>
    </AuthFrame>
  );
}

export function RegisterPage() {
  const { applyLogin } = useAuth();
  const { message } = AntApp.useApp();
  const navigate = useNavigate();
  const register = useMutation({
    mutationFn: authApi.registerWithPassword,
    onSuccess: (result) => {
      applyLogin(result);
      void message.success("账号已创建");
      navigate(landingPathForUser(result.user), { replace: true });
    }
  });

  return (
    <AuthFrame
      aside="注册后会进入个人或组织工作区，可以继续创建研究项目和接入设备。"
      subtitle="创建 THCPN 控制台账号。"
      title="注册"
    >
      <Form<RegisterForm>
        layout="vertical"
        onFinish={(values) =>
          register.mutate({
            name: values.name.trim(),
            phone: values.phone?.trim() || undefined,
            email: values.email?.trim() || undefined,
            password: values.password
          })
        }
      >
        <Form.Item label="名称" name="name" rules={[{ required: true, message: "请输入名称" }]}>
          <Input autoComplete="name" />
        </Form.Item>
        <Form.Item label="手机号" name="phone">
          <Input autoComplete="tel" />
        </Form.Item>
        <Form.Item label="邮箱" name="email" rules={[{ type: "email", message: "请输入有效邮箱" }]}>
          <Input autoComplete="email" />
        </Form.Item>
        <Form.Item label="密码" name="password" rules={[{ min: 8, message: "密码至少 8 位" }, { required: true, message: "请输入密码" }]}>
          <Input.Password autoComplete="new-password" />
        </Form.Item>
        <Button block htmlType="submit" icon={<UserAddOutlined />} loading={register.isPending} type="primary">
          注册并进入
        </Button>
      </Form>
      {register.error ? <Alert message={formatApiError(register.error)} showIcon type="error" /> : null}
      <Typography.Paragraph className="auth-switch" type="secondary">
        已有账号？ <Link to="/login">登录</Link>
      </Typography.Paragraph>
    </AuthFrame>
  );
}

function AuthFrame({
  aside,
  children,
  subtitle,
  title
}: {
  aside: string;
  children: ReactNode;
  subtitle: string;
  title: string;
}) {
  return (
    <main className="auth-screen">
      <section className="auth-panel">
        <Space className="auth-brand" size={11}>
          <span className="brand-mark">TH</span>
          <span>
            <Typography.Text strong>THCPN</Typography.Text>
            <Typography.Text type="secondary">Research Console</Typography.Text>
          </span>
        </Space>
        <Card className="auth-card">
          <Space className="auth-copy" orientation="vertical" size={6}>
            <Typography.Title level={1}>{title}</Typography.Title>
            <Typography.Text type="secondary">{subtitle}</Typography.Text>
          </Space>
          {children}
        </Card>
      </section>
      <section className="auth-aside" aria-hidden="true">
        <div className="context-grid">
          {Array.from({ length: 24 }).map((_, index) => (
            <span key={index} />
          ))}
        </div>
        <div>
          <span>Workspace bounded</span>
          <strong>设备、成员、数据权限始终在同一个工作区上下文里。</strong>
          <p>{aside}</p>
        </div>
      </section>
    </main>
  );
}
