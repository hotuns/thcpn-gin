import { useState, type FormEvent } from "react";
import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";
import { ArrowRight, MessageSquareText } from "lucide-react";
import { api, formatApiError } from "@thcpn/api";
import { useAuth } from "@thcpn/auth";
import { Brand, Button } from "@thcpn/ui";

const adminUrl = (import.meta.env.VITE_ADMIN_URL as string | undefined) ?? "http://127.0.0.1:5173";

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
  const [smsCode, setSmsCode] = useState("");
  const [mfaCode, setMfaCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  if (user) return user.is_system_admin ? <a href={`${adminUrl}/admin/`}>正在进入系统后台…</a> : <Navigate to="/dashboard" replace />;
  const finish = (result: Awaited<ReturnType<typeof api.auth.login>>) => { signIn(result); const next = new URLSearchParams(location.search).get("next"); if (next?.startsWith("/admin") || result.user.is_system_admin) window.location.assign(`${adminUrl}/admin/`); else navigate(next || "/dashboard", { replace: true }); };
  const submit = async (event: FormEvent) => { event.preventDefault(); setBusy(true); setMessage(""); try { if (register) finish(await api.auth.register({ name, phone: phone || undefined, email: email || undefined, password })); else if (mode === "sms") finish(await api.auth.smsLogin({ phone, code: smsCode, ...(mfaCode ? { mfa_code: mfaCode } : {}), ...(name ? { name } : {}) })); else finish(await api.auth.login({ identifier, password, ...(mfaCode ? { mfa_code: mfaCode } : {}) })); } catch (error) { const value = formatApiError(error); setMessage(`${value.message}${value.requestId ? ` · request id ${value.requestId}` : ""}`); } finally { setBusy(false); } };
  const sendSms = async () => { setBusy(true); try { await api.auth.smsSend({ phone }); setMessage("验证码已发送"); } catch (error) { setMessage(formatApiError(error).message); } finally { setBusy(false); } };
  return <div className="auth-layout"><section className="auth-visual"><Brand /><div className="auth-copy"><div className="eyebrow" style={{ color: "#a7d0ff" }}>PRECISION CONSOLE</div><h1 className="auth-title">把设备现场，<br />变成可读的数据。</h1><p className="auth-lede">THCPN 面向科研物联网，从设备状态到数据出口，保持每一个 Workspace 上下文清楚可追溯。</p></div></section><section className="auth-form-side"><div className="auth-card"><div className="eyebrow">{register ? "CREATE ACCESS" : "SECURE SIGN IN"}</div><h2 className="auth-heading">{register ? "创建访问身份" : "欢迎回来"}</h2>{!register && <div className="auth-mode"><button className={mode === "password" ? "active" : ""} onClick={() => setMode("password")}>密码登录</button><button className={mode === "sms" ? "active" : ""} onClick={() => setMode("sms")}>短信登录</button></div>}<form className="form-grid" onSubmit={submit}>{register && <label className="field"><span className="field-label">姓名</span><input required value={name} onChange={(event) => setName(event.target.value)} /></label>}{register ? <><label className="field"><span className="field-label">手机号</span><input value={phone} onChange={(event) => setPhone(event.target.value)} /></label><label className="field"><span className="field-label">邮箱</span><input type="email" value={email} onChange={(event) => setEmail(event.target.value)} /></label></> : mode === "sms" ? <><label className="field"><span className="field-label">手机号</span><input required value={phone} onChange={(event) => setPhone(event.target.value)} /></label><div className="sms-row"><label className="field"><span className="field-label">短信验证码</span><input required value={smsCode} onChange={(event) => setSmsCode(event.target.value)} /></label><Button type="button" variant="secondary" disabled={!phone || busy} onClick={() => void sendSms()}><MessageSquareText size={14} />发送</Button></div></> : <label className="field"><span className="field-label">手机号或邮箱</span><input required value={identifier} onChange={(event) => setIdentifier(event.target.value)} /></label>}{(register || mode === "password") && <label className="field"><span className="field-label">密码</span><input required minLength={8} type="password" value={password} onChange={(event) => setPassword(event.target.value)} /></label>}{!register && <label className="field"><span className="field-label">MFA 验证码 <span className="muted">（已启用时填写）</span></span><input inputMode="numeric" value={mfaCode} onChange={(event) => setMfaCode(event.target.value)} /></label>}{message && <div className={message.includes("已发送") ? "command-note" : "form-error"}>{message}</div>}<Button type="submit" disabled={busy}>{busy ? "处理中…" : register ? "创建账户" : "登录控制台"}<ArrowRight size={15} /></Button></form><div className="auth-form-footer"><span>{register ? "已有账号？" : "还没有账号？"}</span><Link className="link" to={register ? "/login" : "/register"}>{register ? "返回登录" : "创建账户"}</Link></div></div></section></div>;
}
