import { useEffect, useState, type FormEvent } from "react";
import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, KeyRound, MessageSquareText } from "lucide-react";
import { api, ApiError, formatApiError } from "@thcpn/api";
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
  const [forgotPassword, setForgotPassword] = useState(false);
  const [identifier, setIdentifier] = useState("");
  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
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
  const visuals = useQuery({ queryKey: ["login-visuals"], queryFn: api.auth.loginVisuals, staleTime: 5 * 60_000 });
  const [visualIndex, setVisualIndex] = useState(0);
  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = window.setInterval(
      () => setCooldown((value) => Math.max(0, value - 1)),
      1000,
    );
    return () => window.clearInterval(timer);
  }, [cooldown > 0]);
  useEffect(() => {
    const count = visuals.data?.items.length ?? 0;
    if (count < 2) return;
    const timer = window.setInterval(() => setVisualIndex((value) => (value + 1) % count), 3000);
    return () => window.clearInterval(timer);
  }, [visuals.data?.items.length]);
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
    if (forgotPassword) {
      if (!validPassword(password)) {
        setMessage(t("platform:auth.passwordRule"));
        return;
      }
      if (password !== initialPasswordConfirm) {
        setMessage(t("platform:auth.passwordMismatch"));
        return;
      }
      setBusy(true);
      try {
        await api.auth.resetPassword({ phone: phone.trim(), code: smsCode, new_password: password });
        setForgotPassword(false);
        setSmsCode("");
        setPassword("");
        setInitialPasswordConfirm("");
        setMessage(t("platform:auth.resetSuccess"));
        setSuccess(true);
      } catch (error) {
        const value = formatApiError(error);
        setMessage(`${value.message}${value.requestId ? ` · request id ${value.requestId}` : ""}`);
      } finally {
        setBusy(false);
      }
      return;
    }
    if (register && (!name.trim() || !phone.trim())) {
      setMessage(t("platform:auth.contactRequired"));
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
          await api.auth.smsRegister({
            phone: phone.trim(),
            code: smsCode,
            name: name.trim(),
          }),
        );
      else if (mode === "sms")
        finish(
          await api.auth.smsLogin({
            phone: phone.trim(),
            code: smsCode,
            ...(mfaCode ? { mfa_code: mfaCode } : {}),
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
      const rawMessage = error instanceof ApiError ? error.message : value.message;
      if (!register && mfaRequiredMessage(rawMessage)) setMfaRequired(true);
      const message = !register && mode === "password" && value.status === 401 && !mfaRequiredMessage(rawMessage)
        ? t("platform:auth.invalidCredentials")
        : value.message;
      setMessage(
        `${message}${value.requestId ? ` · request id ${value.requestId}` : ""}`,
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
      const result = forgotPassword
        ? await api.auth.sendPasswordResetCode(phone.trim())
        : await api.auth.smsSend({ phone: phone.trim() });
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
        {visuals.data?.items.length ? <div className="auth-visual-carousel" aria-hidden="true">{visuals.data.items.map((item,index)=><img key={item.id} src={item.url} alt="" className={index===visualIndex?"is-active":""}/>)}</div> : null}
        {visuals.data?.items.length ? <div className="auth-visual-shade" aria-hidden="true" /> : null}
        <Brand />
        <div className="auth-language"><LanguageSwitcher compact /></div>
      </section>
      <section className="auth-form-side">
        <div className="auth-card">
          <div className="eyebrow">
            {initialPasswordToken
              ? "FIRST PASSWORD"
              : forgotPassword
              ? "RESET PASSWORD"
              : register
              ? "CREATE ACCESS"
              : mfaRequired
                ? "SECOND FACTOR"
                : "SECURE SIGN IN"}
          </div>
          <h2 className="auth-heading">
            {initialPasswordToken
              ? t("platform:auth.setupPassword")
              : forgotPassword
              ? t("platform:auth.forgotPassword")
              : register
              ? t("platform:auth.createIdentity")
              : mfaRequired
                ? t("platform:auth.completeMfa")
                : t("platform:auth.welcome")}
          </h2>
          {!initialPasswordToken && !forgotPassword && !register && !mfaRequired && (
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
            ) : forgotPassword ? (
              <>
                <label className="field"><span className="field-label">{t("platform:auth.phone")}</span><input required type="tel" inputMode="tel" value={phone} onChange={(event) => setPhone(event.target.value)} /></label>
                <div className="sms-row"><label className="field"><span className="field-label">{t("platform:auth.smsCode")}</span><input required inputMode="numeric" maxLength={6} value={smsCode} onChange={(event) => setSmsCode(event.target.value.replace(/\D/g, ""))} /></label><Button type="button" variant="secondary" disabled={!phone.trim() || busy || cooldown > 0} onClick={() => void sendSms()}><MessageSquareText size={14} />{cooldown > 0 ? `${cooldown}s` : t("platform:auth.send")}</Button></div>
                <label className="field"><span className="field-label">{t("platform:auth.newPassword")}</span><input required minLength={8} maxLength={128} type="password" value={password} onChange={(event) => setPassword(event.target.value)} /></label>
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
                  <span className="field-label">{t("platform:auth.phone")}</span>
                  <input
                    required
                    type="tel"
                    inputMode="tel"
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
            ) : mode === "sms" ? (
              <>
                <label className="field">
                  <span className="field-label">{t("platform:auth.phone")}</span>
                  <input
                    required
                    type="tel"
                    inputMode="tel"
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
                <span className="field-label">{t("platform:auth.phone")}</span>
                <input
                  required
                  type="tel"
                  inputMode="tel"
                  pattern="[+0-9 -]{6,22}"
                  value={identifier}
                  onChange={(event) => setIdentifier(event.target.value)}
                />
              </label>
            )}
            {!register && mode === "password" && (
              <><label className="field">
                <span className="field-label">{t("platform:auth.password")}</span>
                <input
                  required
                  minLength={8}
                  maxLength={128}
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                />
              </label><button type="button" className="link auth-forgot-link" onClick={() => { setForgotPassword(true); setMessage(""); setSuccess(false); }}>{t("platform:auth.forgotPassword")}</button></>
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
                    : forgotPassword
                    ? t("platform:auth.resetPassword")
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
          {forgotPassword ? <div className="auth-form-footer"><button type="button" className="link" onClick={() => { setForgotPassword(false); setMessage(""); }}>{t("platform:auth.backLogin")}</button></div> : <div className="auth-form-footer">
            <span>{register ? t("platform:auth.hasAccount") : t("platform:auth.noAccount")}</span>
            <Link className="link" to={register ? "/login" : "/register"}>
              {register ? t("platform:auth.backLogin") : t("platform:auth.register")}
            </Link>
          </div>}
        </div>
      </section>
    </div>
  );
}
