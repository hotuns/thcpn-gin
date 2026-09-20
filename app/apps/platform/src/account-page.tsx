import { useNavigate, useSearchParams } from "react-router-dom";
import { useState, type FormEvent } from "react";
import { ArrowLeft, Check, Mail, Moon, Palette, Pencil, Phone, Sun, UserRound } from "lucide-react";
import { api, commonStatusLabel, formatApiError } from "@thcpn/api";
import { useAuth } from "@thcpn/auth";
import { Badge, Button, CopyId, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, Input, PageHeader, Panel, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Tabs, TabsContent, TabsList, TabsTrigger } from "./platform-ui";
import { useLocale, useTheme, type ThemeMode } from "@thcpn/i18n";
import { SecurityTab } from "./security-tab";
import { useColorTheme, type ColorTheme } from "./color-theme";

const formatTime = (input?: string) =>
  input
    ? new Intl.DateTimeFormat(document.documentElement.lang || "zh-CN", {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(new Date(input))
    : "—";

export function AccountPage() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const tab = params.get("tab") === "security" ? "security" : params.get("tab") === "preferences" ? "preferences" : "profile";
  const { t } = useLocale();
  return (
    <>
      <PageHeader
        eyebrow={t("platform:navigation.account")}
        title={t("platform:navigation.account")}
        description={t("preferences")}
        actions={<Button variant="secondary" onClick={() => navigate("/dashboard")}><ArrowLeft size={14} />{t("backToOverview")}</Button>}
      />
      <Tabs value={tab} onValueChange={(value) => setParams({ tab: value })}>
        <TabsList className="account-tabs">
          <TabsTrigger value="profile">{t("platform:account.profile")}</TabsTrigger>
          <TabsTrigger value="security">{t("platform:account.security")}</TabsTrigger>
          <TabsTrigger value="preferences">{t("preferences")}</TabsTrigger>
        </TabsList>
        <TabsContent value="profile"><AccountProfile /></TabsContent>
        <TabsContent value="security"><SecurityTab /></TabsContent>
        <TabsContent value="preferences"><PreferencesTab /></TabsContent>
      </Tabs>
    </>
  );
}

function PreferencesTab() {
  const { locale, setLocale, t } = useLocale();
  const { theme, setTheme } = useTheme();
  const { colorTheme, setColorTheme } = useColorTheme();
  const themeOptions: Array<{ value: ThemeMode; label: string; icon: typeof Sun }> = [
    { value: "system", label: t("themeSystem"), icon: Sun },
    { value: "light", label: t("themeLight"), icon: Sun },
    { value: "dark", label: t("themeDark"), icon: Moon },
  ];
  const colorThemeOptions: Array<{
    value: ColorTheme;
    label: string;
    description: string;
  }> = (["pine", "pulse", "forest"] as ColorTheme[]).map((value) => ({ value, label: t(`platform:account.colorThemes.${value}.label`), description: t(`platform:account.colorThemes.${value}.description`) }));
  return <Panel className="preferences-panel">
    <div className="preference-list">
      <div className="preference-row">
        <div><strong>{t("language")}</strong><small>{t("languageDescription")}</small></div>
        <Select value={locale} onValueChange={(value) => void setLocale(value as "zh-CN" | "en-US")}>
          <SelectTrigger aria-label={t("language")}><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="zh-CN">{t("chinese")}</SelectItem><SelectItem value="en-US">{t("english")}</SelectItem></SelectContent>
        </Select>
      </div>
      <div className="preference-row">
        <div><strong>{t("appearance")}</strong><small>{t("appearanceDescription")}</small></div>
        <Select value={theme} onValueChange={(value) => setTheme(value as ThemeMode)}>
          <SelectTrigger aria-label={t("theme")}><SelectValue /></SelectTrigger>
          <SelectContent>{themeOptions.map(({ value, label }) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent>
        </Select>
      </div>
      <div className="preference-row color-theme-preference">
        <div>
          <strong><Palette size={15} />{t("platform:account.colorTheme")}</strong>
          <small>{t("platform:account.colorThemeDescription")}</small>
        </div>
        <div className="color-theme-options" role="radiogroup" aria-label={t("platform:account.colorTheme")}>
          {colorThemeOptions.map((option) => (
            <button
              type="button"
              role="radio"
              aria-checked={colorTheme === option.value}
              className={`color-theme-option color-theme-${option.value}${colorTheme === option.value ? " selected" : ""}`}
              key={option.value}
              onClick={() => setColorTheme(option.value)}
            >
              <span className="color-theme-swatch" aria-hidden="true"><i /><i /><i /></span>
              <span><strong>{option.label}</strong><small>{option.description}</small></span>
              <Check className="color-theme-check" size={15} aria-hidden="true" />
            </button>
          ))}
        </div>
      </div>
    </div>
  </Panel>;
}

function AccountProfile() {
  const { t } = useLocale();
  const { user, refreshUser } = useAuth();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState("");
  if (!user) return null;
  const save = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); setFeedback("");
    try { await api.me.update({ name }); await refreshUser(); setEditing(false); setFeedback(t("platform:account.nameUpdated")); }
    catch (error) { const item = formatApiError(error); setFeedback(`${item.message}${item.requestId ? ` · request id ${item.requestId}` : ""}`); }
    finally { setBusy(false); }
  };
  return (
    <Panel className="preferences-panel account-profile-panel">
      <div className="preference-list">
        <div className="preference-row account-profile-summary"><div><strong><UserRound size={15} />{t("platform:account.name")}</strong><small>{t("platform:account.nameDescription")}</small></div><div className="preference-value"><span>{user.name}</span><Button variant="secondary" onClick={() => { setName(user.name); setEditing(true); }}><Pencil size={13} />{t("edit")}</Button></div></div>
        <div className="preference-row"><div><strong><Mail size={15} />{t("platform:auth.email")}</strong><small>{t("platform:account.emailDescription")}</small></div><div className="preference-value"><span>{user.email ?? t("platform:account.notSet")}</span><Badge tone={user.email_verified_at ? "success" : "warning"}>{t(user.email_verified_at ? "platform:account.verified" : "platform:account.unverified")}</Badge></div></div>
        <div className="preference-row"><div><strong><Phone size={15} />{t("platform:auth.phone")}</strong><small>{t("platform:account.phoneDescription")}</small></div><div className="preference-value"><span>{user.phone ?? t("platform:account.notSet")}</span><Badge tone={user.phone_verified_at ? "success" : "warning"}>{t(user.phone_verified_at ? "platform:account.verified" : "platform:account.unverified")}</Badge></div></div>
        <div className="preference-row"><div><strong>{t("platform:account.status")}</strong><small>{t("platform:account.statusDescription")}</small></div><Badge tone={user.status === "active" ? "success" : "warning"}>{commonStatusLabel(user.status)}</Badge></div>
        <div className="preference-row"><div><strong>{t("platform:account.lastLogin")}</strong><small>{formatTime(user.last_login_at)}</small></div></div>
        <div className="preference-row"><div><strong>{t("platform:account.userId")}</strong><small>{t("platform:account.userIdDescription")}</small></div><CopyId value={user.id} /></div>
      </div>
      {feedback && <div className="command-note section-gap">{feedback}</div>}
      <Dialog open={editing} onOpenChange={(open) => !busy && setEditing(open)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("platform:account.editName")}</DialogTitle>
            <DialogDescription>{t("platform:account.editNameDescription")}</DialogDescription>
          </DialogHeader>
          <form className="security-form shadcn-dialog-form" onSubmit={save}>
            <label className="field">
              <span className="field-label">{t("platform:account.name")}</span>
              <Input autoFocus required maxLength={100} value={name} onChange={(event) => setName(event.target.value)} />
            </label>
            <DialogFooter>
              <Button type="button" variant="secondary" onClick={() => setEditing(false)}>{t("cancel")}</Button>
              <Button type="submit" disabled={busy || !name.trim()}>{busy ? t("loading") : t("save")}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </Panel>
  );
}
