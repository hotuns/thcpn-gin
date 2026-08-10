import { useSearchParams } from "react-router-dom";
import { useState, type FormEvent } from "react";
import { Check, Mail, Moon, Palette, Pencil, Phone, Sun, UserRound, X } from "lucide-react";
import { api, commonStatusLabel, formatApiError } from "@thcpn/api";
import { useAuth } from "@thcpn/auth";
import { Badge, Button, CopyId, PageHeader, Panel } from "@thcpn/ui";
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
  const [params, setParams] = useSearchParams();
  const tab = params.get("tab") === "security" ? "security" : params.get("tab") === "preferences" ? "preferences" : "profile";
  const { t } = useLocale();
  return (
    <>
      <PageHeader
        eyebrow={t("platform:navigation.account")}
        title={t("platform:navigation.account")}
        description={t("preferences")}
      />
      <div className="settings-tabs account-tabs">
        <button
          type="button"
          className={tab === "profile" ? "active" : ""}
          onClick={() => setParams({ tab: "profile" })}
        >
          账户资料
        </button>
        <button
          type="button"
          className={tab === "security" ? "active" : ""}
          onClick={() => setParams({ tab: "security" })}
        >
          账号安全
        </button>
        <button type="button" className={tab === "preferences" ? "active" : ""} onClick={() => setParams({ tab: "preferences" })}>
          {t("preferences")}
        </button>
      </div>
      {tab === "security" ? <SecurityTab /> : tab === "preferences" ? <PreferencesTab /> : <AccountProfile />}
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
  }> = locale === "zh-CN"
    ? [
        { value: "pine", label: "松针", description: "深青绿与暖金，沉静精密" },
        { value: "ocean", label: "海湾", description: "矿物蓝与雾灰，清晰理性" },
        { value: "clay", label: "陶土", description: "砖红与铜色，温暖稳重" },
        { value: "aurora", label: "极光", description: "青绿与荧光黄，鲜明高效" },
        { value: "iris", label: "鸢尾", description: "紫罗兰与莓红，灵动专注" },
        { value: "obsidian", label: "曜石", description: "近黑与亮黄，强烈克制" },
      ]
    : [
        { value: "pine", label: "Pine", description: "Deep green with warm gold" },
        { value: "ocean", label: "Ocean", description: "Mineral blue with mist gray" },
        { value: "clay", label: "Clay", description: "Brick red with warm copper" },
        { value: "aurora", label: "Aurora", description: "Teal with electric lime" },
        { value: "iris", label: "Iris", description: "Violet with berry pink" },
        { value: "obsidian", label: "Obsidian", description: "Near black with vivid yellow" },
      ];
  return <Panel className="preferences-panel">
    <div className="preference-list">
      <div className="preference-row">
        <div><strong>{t("language")}</strong><small>{t("languageDescription")}</small></div>
        <select aria-label={t("language")} value={locale} onChange={(event) => void setLocale(event.target.value as "zh-CN" | "en-US")}>
          <option value="zh-CN">{t("chinese")}</option>
          <option value="en-US">{t("english")}</option>
        </select>
      </div>
      <div className="preference-row">
        <div><strong>{t("appearance")}</strong><small>{t("appearanceDescription")}</small></div>
        <select aria-label={t("theme")} value={theme} onChange={(event) => setTheme(event.target.value as ThemeMode)}>
          {themeOptions.map(({ value, label }) => <option key={value} value={value}>{label}</option>)}
        </select>
      </div>
      <div className="preference-row color-theme-preference">
        <div>
          <strong><Palette size={15} />{locale === "zh-CN" ? "颜色主题" : "Color theme"}</strong>
          <small>{locale === "zh-CN" ? "选择平台界面的强调色与氛围。" : "Choose the platform accent colors and atmosphere."}</small>
        </div>
        <div className="color-theme-options" role="radiogroup" aria-label={locale === "zh-CN" ? "颜色主题" : "Color theme"}>
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
  const { user, refreshUser } = useAuth();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState("");
  if (!user) return null;
  const save = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); setFeedback("");
    try { await api.me.update({ name }); await refreshUser(); setEditing(false); setFeedback("账户名称已更新"); }
    catch (error) { const item = formatApiError(error); setFeedback(`${item.message}${item.requestId ? ` · request id ${item.requestId}` : ""}`); }
    finally { setBusy(false); }
  };
  return (
    <Panel className="preferences-panel account-profile-panel">
      <div className="preference-list">
        <div className="preference-row account-profile-summary"><div><strong><UserRound size={15} />账户名称</strong><small>用于展示和账户识别</small></div><div className="preference-value"><span>{user.name}</span><Button variant="secondary" onClick={() => { setName(user.name); setEditing(true); }}><Pencil size={13} />编辑</Button></div></div>
        <div className="preference-row"><div><strong><Mail size={15} />邮箱</strong><small>登录和安全通知邮箱</small></div><div className="preference-value"><span>{user.email ?? "未设置"}</span><Badge tone={user.email_verified_at ? "success" : "warning"}>{user.email_verified_at ? "已验证" : "未验证"}</Badge></div></div>
        <div className="preference-row"><div><strong><Phone size={15} />手机号</strong><small>登录手机号</small></div><div className="preference-value"><span>{user.phone ?? "未设置"}</span><Badge tone={user.phone_verified_at ? "success" : "warning"}>{user.phone_verified_at ? "已验证" : "未验证"}</Badge></div></div>
        <div className="preference-row"><div><strong>账户状态</strong><small>当前账户可用状态</small></div><Badge tone={user.status === "active" ? "success" : "warning"}>{commonStatusLabel(user.status)}</Badge></div>
        <div className="preference-row"><div><strong>最近登录</strong><small>{formatTime(user.last_login_at)}</small></div></div>
        <div className="preference-row"><div><strong>用户 ID</strong><small>系统分配的唯一标识</small></div><CopyId value={user.id} /></div>
      </div>
      {feedback && <div className="command-note section-gap">{feedback}</div>}
      {editing && <div className="modal-layer"><button className="modal-backdrop" aria-label="关闭编辑" onClick={() => setEditing(false)} /><div className="modal-card account-editor" role="dialog" aria-modal="true"><div className="panel-header"><h2 className="panel-title">编辑账户名称</h2><Button variant="secondary" onClick={() => setEditing(false)}><X size={14} />关闭</Button></div><form className="panel-body security-form" onSubmit={save}><label className="field"><span className="field-label">名称</span><input required maxLength={100} value={name} onChange={(event) => setName(event.target.value)} /></label><div className="form-actions"><Button type="button" variant="secondary" onClick={() => setEditing(false)}>取消</Button><Button type="submit" disabled={busy || !name.trim()}>{busy ? "保存中…" : "保存"}</Button></div></form></div></div>}
    </Panel>
  );
}
