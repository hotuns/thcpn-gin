import { useEffect, useState, type FormEvent } from "react";
import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";
import { ArrowRight, KeyRound, MessageSquareText } from "lucide-react";
import { api, formatApiError } from "@thcpn/api";
import { useAuth } from "@thcpn/auth";
import { Brand, Button } from "@thcpn/ui";
import { LanguageSwitcher, useLocale } from "@thcpn/i18n";

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
  const { t } = useLocale();
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
      setMessage(t("platform:auth.temporaryNotice"));
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
        setMessage(t("platform:auth.passwordRule"));
        return;
      }
      if (initialPassword !== initialPasswordConfirm) {
        setMessage(t("platform:auth.passwordMismatch"));
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
      setMessage(t("platform:auth.contactRequired"));
      return;
    }
    if (register && !validPassword(password)) {
      setMessage(t("platform:auth.passwordRule"));
      return;
    }
    if (register && password !== passwordConfirm) {
      setMessage(t("platform:auth.passwordMismatch"));
      return;
    }
    if (mfaRequired && !/^\d{6}$/.test(mfaCode)) {
      setMessage(t("platform:auth.mfaRequired"));
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
        t("platform:auth.codeSent", { minutes: Math.ceil(result.expires_in / 60) }),
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
        <div className="auth-language"><LanguageSwitcher compact /></div>
        <div className="auth-copy">
          <div className="eyebrow" style={{ color: "#a7d0ff" }}>
            PRECISION CONSOLE
          </div>
          <h1 className="auth-title">
            {t("platform:auth.hero")}
          </h1>
          <p className="auth-lede">
            {t("platform:auth.heroCopy")}
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
              ? t("platform:auth.setupPassword")
              : register
              ? t("platform:auth.createIdentity")
              : mfaRequired
                ? t("platform:auth.completeMfa")
                : t("platform:auth.welcome")}
          </h2>
          {!initialPasswordToken && !register && !mfaRequired && (
            <div className="auth-mode">
              <button
                type="button"
                className={mode === "password" ? "active" : ""}
                onClick={() => switchMode("password")}
              >
                {t("platform:auth.passwordLogin")}
              </button>
              <button
                type="button"
                className={mode === "sms" ? "active" : ""}
                onClick={() => switchMode("sms")}
              >
                {t("platform:auth.smsLogin")}
              </button>
            </div>
          )}
          <form className="form-grid" onSubmit={submit}>
            {initialPasswordToken ? (
              <>
                <div className="command-note">{t("platform:auth.temporaryHelp")}</div>
                <label className="field"><span className="field-label">{t("platform:auth.newPassword")}</span><input autoFocus required minLength={8} maxLength={128} type="password" value={initialPassword} onChange={(event) => setInitialPassword(event.target.value)} /></label>
                <label className="field"><span className="field-label">{t("platform:auth.confirmNewPassword")}</span><input required type="password" value={initialPasswordConfirm} onChange={(event) => setInitialPasswordConfirm(event.target.value)} /></label>
              </>
            ) : <>
            {register && (
              <label className="field">
                <span className="field-label">{t("platform:auth.name")}</span>
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
                    {t("platform:auth.phone")} <span className="muted">({t("platform:auth.contactHint")})</span>
                  </span>
                  <input
                    value={phone}
                    onChange={(event) => setPhone(event.target.value)}
                  />
                </label>
                <label className="field">
                  <span className="field-label">{t("platform:auth.email")}</span>
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
                  <span className="field-label">{t("platform:auth.phone")}</span>
                  <input
                    required
                    value={phone}
                    onChange={(event) => setPhone(event.target.value)}
                  />
                </label>
                <div className="sms-row">
                  <label className="field">
                    <span className="field-label">{t("platform:auth.smsCode")}</span>
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
                    {cooldown > 0 ? `${cooldown}s` : t("platform:auth.send")}
                  </Button>
                </div>
              </>
            ) : (
              <label className="field">
                <span className="field-label">{t("platform:auth.phoneOrEmail")}</span>
                <input
                  required
                  value={identifier}
                  onChange={(event) => setIdentifier(event.target.value)}
                />
              </label>
            )}
            {(register || mode === "password") && (
              <label className="field">
                <span className="field-label">{t("platform:auth.password")}</span>
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
                <span className="field-label">{t("platform:auth.confirmPassword")}</span>
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
                  {t("platform:auth.mfaCode")}
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
                ? t("platform:auth.processing")
                : mfaRequired
                  ? t("platform:auth.verifyLogin")
                  : initialPasswordToken
                    ? t("platform:auth.savePassword")
                    : register
                    ? t("platform:auth.register")
                    : t("platform:auth.loginConsole")}
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
                {t("platform:auth.backCredentials")}
              </Button>
            )}
          </form>
          <div className="auth-form-footer">
            <span>{register ? t("platform:auth.hasAccount") : t("platform:auth.noAccount")}</span>
            <Link className="link" to={register ? "/login" : "/register"}>
              {register ? t("platform:auth.backLogin") : t("platform:auth.register")}
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
