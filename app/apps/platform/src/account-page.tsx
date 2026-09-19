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
        actions={<Button variant="secondary" onClick={() => navigate("/dashboard")}><ArrowLeft size={14} />返回总览</Button>}
      />
      <Tabs value={tab} onValueChange={(value) => setParams({ tab: value })}>
        <TabsList className="account-tabs">
          <TabsTrigger value="profile">账户资料</TabsTrigger>
          <TabsTrigger value="security">账号安全</TabsTrigger>
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
  }> = locale === "zh-CN"
    ? [
        { value: "pine", label: "原位生态", description: "自然青绿与暖金，默认平衡" },
        { value: "pulse", label: "跃光", description: "亮青、荧光黄与珊瑚橙，鲜明跳跃" },
        { value: "forest", label: "深林", description: "苔绿、石墨与暗金，深沉专注" },
      ]
    : [
        { value: "pine", label: "In-situ Eco", description: "Natural teal and warm gold" },
        { value: "pulse", label: "Pulse", description: "Bright teal, electric lime and coral" },
        { value: "forest", label: "Deep Forest", description: "Moss, graphite and muted gold" },
      ];
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
          <strong><Palette size={15} />{locale === "zh-CN" ? "颜色主题" : "Color theme"}</strong>
          <small>{locale === "zh-CN" ? "切换完整的页面、面板、导航与强调色体系。" : "Switch the complete surface, navigation and accent system."}</small>
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
      <Dialog open={editing} onOpenChange={(open) => !busy && setEditing(open)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>编辑账户名称</DialogTitle>
            <DialogDescription>这个名称用于平台展示和账户识别。</DialogDescription>
          </DialogHeader>
          <form className="security-form shadcn-dialog-form" onSubmit={save}>
            <label className="field">
              <span className="field-label">名称</span>
              <Input autoFocus required maxLength={100} value={name} onChange={(event) => setName(event.target.value)} />
            </label>
            <DialogFooter>
              <Button type="button" variant="secondary" onClick={() => setEditing(false)}>取消</Button>
              <Button type="submit" disabled={busy || !name.trim()}>{busy ? "保存中…" : "保存"}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </Panel>
  );
}
