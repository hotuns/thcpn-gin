import { useState, type FormEvent, type ReactNode } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useMutation } from "@tanstack/react-query";
import { KeyRound, MessageSquareText, ShieldCheck } from "lucide-react";
import { authApi, formatApiError } from "../../api";
import { Button, TextInput, useToast } from "../../components";
import { useAuth } from "../../app/AuthProvider";

type LoginMode = "password" | "sms";

export function LoginPage() {
  const [mode, setMode] = useState<LoginMode>("password");
  const [passwordForm, setPasswordForm] = useState({ identifier: "", password: "", mfa_code: "" });
  const [smsForm, setSmsForm] = useState({ phone: "", code: "", mfa_code: "", name: "" });
  const { applyLogin } = useAuth();
  const { pushToast } = useToast();
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: { pathname?: string } } | null)?.from?.pathname || "/dashboard";

  const passwordLogin = useMutation({
    mutationFn: authApi.loginWithPassword,
    onSuccess: (result) => {
      applyLogin(result);
      pushToast("登录成功");
      navigate(from, { replace: true });
    }
  });

  const sendSms = useMutation({
    mutationFn: authApi.sendSms,
    onSuccess: (result) => pushToast(`验证码已发送，有效期 ${result.expires_in} 秒`, "info")
  });

  const smsLogin = useMutation({
    mutationFn: authApi.loginWithSms,
    onSuccess: (result) => {
      applyLogin(result);
      pushToast(result.created ? "账号已创建并登录" : "登录成功");
      navigate(from, { replace: true });
    }
  });

  function handlePasswordLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    passwordLogin.mutate({
      identifier: passwordForm.identifier.trim(),
      password: passwordForm.password,
      mfa_code: passwordForm.mfa_code.trim() || undefined
    });
  }

  function handleSendSms(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    sendSms.mutate(smsForm.phone.trim());
  }

  function handleSmsLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    smsLogin.mutate({
      phone: smsForm.phone.trim(),
      code: smsForm.code.trim(),
      mfa_code: smsForm.mfa_code.trim() || undefined,
      name: smsForm.name.trim() || undefined
    });
  }

  const activeError = passwordLogin.error || sendSms.error || smsLogin.error;

  return (
    <AuthFrame
      aside="多工作区、设备、数据集和共享授权集中管理。"
      subtitle="登录后进入 THCPN 研究控制台。"
      title="登录"
    >
      <div className="segmented" role="tablist">
        <button aria-selected={mode === "password"} onClick={() => setMode("password")} type="button">
          密码
        </button>
        <button aria-selected={mode === "sms"} onClick={() => setMode("sms")} type="button">
          短信
        </button>
      </div>

      {mode === "password" ? (
        <form className="form-stack" onSubmit={handlePasswordLogin}>
          <TextInput
            autoComplete="username"
            label="手机号或邮箱"
            onChange={(event) => setPasswordForm({ ...passwordForm, identifier: event.target.value })}
            required
            value={passwordForm.identifier}
          />
          <TextInput
            autoComplete="current-password"
            label="密码"
            onChange={(event) => setPasswordForm({ ...passwordForm, password: event.target.value })}
            required
            type="password"
            value={passwordForm.password}
          />
          <TextInput
            inputMode="numeric"
            label="MFA 码"
            maxLength={6}
            onChange={(event) => setPasswordForm({ ...passwordForm, mfa_code: event.target.value })}
            value={passwordForm.mfa_code}
          />
          <Button disabled={passwordLogin.isPending} icon={<KeyRound size={16} />} type="submit" variant="primary">
            登录
          </Button>
        </form>
      ) : (
        <div className="form-stack">
          <form className="inline-action-form" onSubmit={handleSendSms}>
            <TextInput
              autoComplete="tel"
              label="手机号"
              onChange={(event) => setSmsForm({ ...smsForm, phone: event.target.value })}
              required
              value={smsForm.phone}
            />
            <Button disabled={sendSms.isPending} icon={<MessageSquareText size={16} />} type="submit">
              发送验证码
            </Button>
          </form>
          <form className="form-stack" onSubmit={handleSmsLogin}>
            <TextInput
              inputMode="numeric"
              label="验证码"
              maxLength={6}
              onChange={(event) => setSmsForm({ ...smsForm, code: event.target.value })}
              required
              value={smsForm.code}
            />
            <TextInput
              inputMode="numeric"
              label="MFA 码"
              maxLength={6}
              onChange={(event) => setSmsForm({ ...smsForm, mfa_code: event.target.value })}
              value={smsForm.mfa_code}
            />
            <TextInput
              label="新账号名称"
              onChange={(event) => setSmsForm({ ...smsForm, name: event.target.value })}
              value={smsForm.name}
            />
            <Button disabled={smsLogin.isPending} icon={<ShieldCheck size={16} />} type="submit" variant="primary">
              短信登录
            </Button>
          </form>
        </div>
      )}

      {activeError ? <p className="form-error">{formatApiError(activeError)}</p> : null}
      <p className="auth-switch">
        没有账号？ <Link to="/register">注册</Link>
      </p>
    </AuthFrame>
  );
}

export function RegisterPage() {
  const [form, setForm] = useState({ name: "", phone: "", email: "", password: "" });
  const { applyLogin } = useAuth();
  const { pushToast } = useToast();
  const navigate = useNavigate();
  const register = useMutation({
    mutationFn: authApi.registerWithPassword,
    onSuccess: (result) => {
      applyLogin(result);
      pushToast("账号已创建");
      navigate("/dashboard", { replace: true });
    }
  });

  function handleRegister(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    register.mutate({
      name: form.name.trim(),
      phone: form.phone.trim() || undefined,
      email: form.email.trim() || undefined,
      password: form.password
    });
  }

  return (
    <AuthFrame
      aside="注册后会进入个人或组织工作区，可以继续创建研究项目和接入设备。"
      subtitle="创建 THCPN 控制台账号。"
      title="注册"
    >
      <form className="form-stack" onSubmit={handleRegister}>
        <TextInput
          autoComplete="name"
          label="名称"
          onChange={(event) => setForm({ ...form, name: event.target.value })}
          required
          value={form.name}
        />
        <TextInput
          autoComplete="tel"
          label="手机号"
          onChange={(event) => setForm({ ...form, phone: event.target.value })}
          value={form.phone}
        />
        <TextInput
          autoComplete="email"
          label="邮箱"
          onChange={(event) => setForm({ ...form, email: event.target.value })}
          type="email"
          value={form.email}
        />
        <TextInput
          autoComplete="new-password"
          label="密码"
          minLength={8}
          onChange={(event) => setForm({ ...form, password: event.target.value })}
          required
          type="password"
          value={form.password}
        />
        <Button disabled={register.isPending} icon={<KeyRound size={16} />} type="submit" variant="primary">
          注册并进入
        </Button>
      </form>
      {register.error ? <p className="form-error">{formatApiError(register.error)}</p> : null}
      <p className="auth-switch">
        已有账号？ <Link to="/login">登录</Link>
      </p>
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
        <div className="auth-brand">
          <span className="brand-mark">TH</span>
          <div>
            <strong>THCPN</strong>
            <span>Research Console</span>
          </div>
        </div>
        <div className="auth-copy">
          <h1>{title}</h1>
          <p>{subtitle}</p>
        </div>
        {children}
      </section>
      <aside className="auth-aside">
        <div className="context-grid" aria-hidden="true">
          {Array.from({ length: 36 }).map((_, index) => (
            <span key={index} />
          ))}
        </div>
        <div>
          <span>Workspace Scope</span>
          <strong>{aside}</strong>
        </div>
      </aside>
    </main>
  );
}
