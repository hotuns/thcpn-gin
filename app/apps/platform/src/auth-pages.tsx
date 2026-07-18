import { useEffect, useState, type FormEvent } from "react";
import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";
import { ArrowRight, KeyRound, MessageSquareText } from "lucide-react";
import { api, formatApiError } from "@thcpn/api";
import { useAuth } from "@thcpn/auth";
import { Brand, Button } from "@thcpn/ui";

export const validPassword = (value: string) =>
  value.length >= 8 &&
  value.length <= 128 &&
  /[A-Za-z]/.test(value) &&
  /\d/.test(value);
export const mfaRequiredMessage = (message: string) =>
  /mfa|totp|two.?factor|动态验证码/i.test(message);
export const platformNextPath = (value: string | null) =>
  value?.startsWith("/") &&
  !value.startsWith("//") &&
  !value.startsWith("/admin")
    ? value
    : null;

export function AuthPage({ register = false }: { register?: boolean }) {
  const { user, signIn } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [mode, setMode] = useState<"password" | "sms">("password");
  const [identifier, setIdentifier] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const [smsCode, setSmsCode] = useState("");
  const [mfaCode, setMfaCode] = useState("");
  const [mfaRequired, setMfaRequired] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [success, setSuccess] = useState(false);
  const [initialPasswordToken, setInitialPasswordToken] = useState("");
  const [initialPassword, setInitialPassword] = useState("");
  const [initialPasswordConfirm, setInitialPasswordConfirm] = useState("");
  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = window.setInterval(
      () => setCooldown((value) => Math.max(0, value - 1)),
      1000,
    );
    return () => window.clearInterval(timer);
  }, [cooldown > 0]);
  const next = platformNextPath(
    new URLSearchParams(location.search).get("next"),
  );
  if (user) return <Navigate to={next ?? "/dashboard"} replace />;
  const finish = (result: Awaited<ReturnType<typeof api.auth.login>>) => {
    if (result.password_change_required && result.password_change_token) {
      setInitialPasswordToken(result.password_change_token);
      setPassword("");
      setInitialPasswordConfirm("");
      setMessage("这是一次性临时密码，请先设置新密码。");
      setSuccess(true);
      return;
    }
    signIn(result);
    if (next) navigate(next, { replace: true });
    else navigate("/dashboard", { replace: true });
  };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setMessage("");
    setSuccess(false);
    if (initialPasswordToken) {
      if (!validPassword(initialPassword)) {
        setMessage("密码需要 8-128 位，并同时包含字母和数字");
        return;
      }
      if (initialPassword !== initialPasswordConfirm) {
        setMessage("两次输入的密码不一致");
        return;
      }
      setBusy(true);
      try {
        finish(await api.auth.completeInitialPassword({ password_change_token: initialPasswordToken, password: initialPassword }));
        setInitialPasswordToken("");
      } catch (error) {
        const value = formatApiError(error);
        setMessage(`${value.message}${value.requestId ? ` · request id ${value.requestId}` : ""}`);
      } finally {
        setBusy(false);
      }
      return;
    }
    if (register && !phone.trim() && !email.trim()) {
      setMessage("请至少填写手机号或邮箱");
      return;
    }
    if (register && !validPassword(password)) {
      setMessage("密码需要 8-128 位，并同时包含字母和数字");
      return;
    }
    if (register && password !== passwordConfirm) {
      setMessage("两次输入的密码不一致");
      return;
    }
    if (mfaRequired && !/^\d{6}$/.test(mfaCode)) {
      setMessage("请输入身份验证器中的 6 位动态验证码");
      return;
    }
    setBusy(true);
    try {
      if (register)
        finish(
          await api.auth.register({
            name: name.trim(),
            phone: phone.trim() || undefined,
            email: email.trim() || undefined,
            password,
          }),
        );
      else if (mode === "sms")
        finish(
          await api.auth.smsLogin({
            phone: phone.trim(),
            code: smsCode,
            ...(mfaCode ? { mfa_code: mfaCode } : {}),
            ...(name.trim() ? { name: name.trim() } : {}),
          }),
        );
      else
        finish(
          await api.auth.login({
            identifier: identifier.trim(),
            password,
            ...(mfaCode ? { mfa_code: mfaCode } : {}),
          }),
        );
    } catch (error) {
      const value = formatApiError(error);
      if (!register && mfaRequiredMessage(value.message)) setMfaRequired(true);
      setMessage(
        `${value.message}${value.requestId ? ` · request id ${value.requestId}` : ""}`,
      );
    } finally {
      setBusy(false);
    }
  };
  const sendSms = async () => {
    setBusy(true);
    setMessage("");
    setSuccess(false);
    try {
      const result = await api.auth.smsSend({ phone: phone.trim() });
      setCooldown(result.cooldown_seconds);
      setMessage(
        `验证码已发送，${Math.ceil(result.expires_in / 60)} 分钟内有效`,
      );
      setSuccess(true);
    } catch (error) {
      const value = formatApiError(error);
      setMessage(
        `${value.message}${value.requestId ? ` · request id ${value.requestId}` : ""}`,
      );
    } finally {
      setBusy(false);
    }
  };
  const switchMode = (next: "password" | "sms") => {
    setMode(next);
    setMfaRequired(false);
    setMfaCode("");
    setMessage("");
  };
  return (
    <div className="auth-layout">
      <section className="auth-visual">
        <Brand />
        <div className="auth-copy">
          <div className="eyebrow" style={{ color: "#a7d0ff" }}>
            PRECISION CONSOLE
          </div>
          <h1 className="auth-title">
            把设备现场，
            <br />
            变成可读的数据。
          </h1>
          <p className="auth-lede">
            THCPN 面向科研物联网，从设备状态到数据出口，让每个工作区内的设备与数据清楚可追溯。
          </p>
        </div>
      </section>
      <section className="auth-form-side">
        <div className="auth-card">
          <div className="eyebrow">
            {initialPasswordToken
              ? "FIRST PASSWORD"
              : register
              ? "CREATE ACCESS"
              : mfaRequired
                ? "SECOND FACTOR"
                : "SECURE SIGN IN"}
          </div>
          <h2 className="auth-heading">
            {initialPasswordToken
              ? "设置登录密码"
              : register
              ? "创建访问身份"
              : mfaRequired
                ? "完成双重验证"
                : "欢迎回来"}
          </h2>
          {!initialPasswordToken && !register && !mfaRequired && (
            <div className="auth-mode">
              <button
                type="button"
                className={mode === "password" ? "active" : ""}
                onClick={() => switchMode("password")}
              >
                密码登录
              </button>
              <button
                type="button"
                className={mode === "sms" ? "active" : ""}
                onClick={() => switchMode("sms")}
              >
                短信登录
              </button>
            </div>
          )}
          <form className="form-grid" onSubmit={submit}>
            {initialPasswordToken ? (
              <>
                <div className="command-note">临时密码只用于进入首次设置流程，设置完成后旧密码和旧会话都会失效。</div>
                <label className="field"><span className="field-label">新密码</span><input autoFocus required minLength={8} maxLength={128} type="password" value={initialPassword} onChange={(event) => setInitialPassword(event.target.value)} /></label>
                <label className="field"><span className="field-label">确认新密码</span><input required type="password" value={initialPasswordConfirm} onChange={(event) => setInitialPasswordConfirm(event.target.value)} /></label>
              </>
            ) : <>
            {register && (
              <label className="field">
                <span className="field-label">姓名</span>
                <input
                  required
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                />
              </label>
            )}
            {register ? (
              <>
                <label className="field">
                  <span className="field-label">
                    手机号 <span className="muted">（与邮箱至少填一项）</span>
                  </span>
                  <input
                    value={phone}
                    onChange={(event) => setPhone(event.target.value)}
                  />
                </label>
                <label className="field">
                  <span className="field-label">邮箱</span>
                  <input
                    type="email"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                  />
                </label>
              </>
            ) : mode === "sms" ? (
              <>
                <label className="field">
                  <span className="field-label">手机号</span>
                  <input
                    required
                    value={phone}
                    onChange={(event) => setPhone(event.target.value)}
                  />
                </label>
                <div className="sms-row">
                  <label className="field">
                    <span className="field-label">短信验证码</span>
                    <input
                      required
                      inputMode="numeric"
                      maxLength={6}
                      value={smsCode}
                      onChange={(event) =>
                        setSmsCode(event.target.value.replace(/\D/g, ""))
                      }
                    />
                  </label>
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={!phone.trim() || busy || cooldown > 0}
                    onClick={() => void sendSms()}
                  >
                    <MessageSquareText size={14} />
                    {cooldown > 0 ? `${cooldown}s` : "发送"}
                  </Button>
                </div>
              </>
            ) : (
              <label className="field">
                <span className="field-label">手机号或邮箱</span>
                <input
                  required
                  value={identifier}
                  onChange={(event) => setIdentifier(event.target.value)}
                />
              </label>
            )}
            {(register || mode === "password") && (
              <label className="field">
                <span className="field-label">密码</span>
                <input
                  required
                  minLength={8}
                  maxLength={128}
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                />
              </label>
            )}
            {register && (
              <label className="field">
                <span className="field-label">确认密码</span>
                <input
                  required
                  type="password"
                  value={passwordConfirm}
                  onChange={(event) => setPasswordConfirm(event.target.value)}
                />
              </label>
            )}
            {mfaRequired && (
              <label className="field mfa-challenge">
                <span className="field-label">
                  <KeyRound size={13} />
                  动态验证码
                </span>
                <input
                  autoFocus
                  required
                  inputMode="numeric"
                  maxLength={6}
                  value={mfaCode}
                  onChange={(event) =>
                    setMfaCode(event.target.value.replace(/\D/g, ""))
                  }
                  placeholder="000000"
                />
              </label>
            )}
            </>}
            {message && (
              <div className={success ? "command-note" : "form-error"}>
                {message}
              </div>
            )}
            <Button type="submit" disabled={busy}>
              {busy
                ? "处理中…"
                : mfaRequired
                  ? "验证并登录"
                  : initialPasswordToken
                    ? "保存新密码"
                    : register
                    ? "创建账户"
                    : "登录控制台"}
              <ArrowRight size={15} />
            </Button>
            {mfaRequired && (
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  setMfaRequired(false);
                  setMfaCode("");
                  setMessage("");
                }}
              >
                返回修改登录信息
              </Button>
            )}
          </form>
          <div className="auth-form-footer">
            <span>{register ? "已有账号？" : "还没有账号？"}</span>
            <Link className="link" to={register ? "/login" : "/register"}>
              {register ? "返回登录" : "创建账户"}
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
