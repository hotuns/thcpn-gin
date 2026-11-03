import { useState, type ComponentType } from "react";
import { Link, useOutletContext } from "react-router-dom";
import { useAuth } from "@thcpn/auth";
import { LanguageSwitcher, useLocale, useTheme } from "@thcpn/i18n";
import { useWorkspace } from "@thcpn/workspace";
import { BarChart3, Building2, ChevronRight, CreditCard, Download, Globe2, HelpCircle, Leaf, LogOut, MapPinned, Settings, ShieldCheck, Table2, Workflow } from "lucide-react";
import { useSystemPolicy } from "../shared/config/system-policy";
import { Button, PageHeader, SelectInput } from "../shared/ui";

type Entry = { to: string; title: string; description: string; icon: ComponentType<{ size?: number }> };
const dataEntries: Entry[] = [
  { to: "/datasets", title: "platform:navigation.datasets", description: "mobile.datasetsDescription", icon: Table2 },
  { to: "/data-compare", title: "platform:navigation.compare", description: "mobile.compareDescription", icon: BarChart3 },
  { to: "/processing", title: "platform:navigation.processing", description: "mobile.processingDescription", icon: Workflow },
  { to: "/exports", title: "platform:navigation.exports", description: "mobile.exportsDescription", icon: Download },
];
function Entries({ items }: { items: Entry[] }) {
  const { t } = useLocale();
  return <div className="mobile-hub-entries">{items.map(({ to, title, description, icon: Icon }) => <Link to={to} key={to} className="mobile-hub-entry"><span className="mobile-hub-icon"><Icon size={23} /></span><span className="mobile-hub-copy"><strong>{t(title)}</strong><small>{t(description)}</small></span><ChevronRight size={18} aria-hidden="true" /></Link>)}</div>;
}
export function DataHubPage() {
  const { t } = useLocale();
  return <section className="mobile-hub-page"><PageHeader title={t("mobile.dataTitle")} description={t("mobile.dataDescription")} /><Entries items={dataEntries} /></section>;
}
export function MorePage() {
  const { t } = useLocale();
  const { theme, setTheme } = useTheme();
  const { user, signOut } = useAuth();
  const { current } = useWorkspace();
  const policy = useSystemPolicy();
  const { openGuide } = useOutletContext<{ openGuide: () => void }>();
  const [busy, setBusy] = useState(false);
  const workspaceEntries: Entry[] = [
    { to: "/workspaces", title: "platform:navigation.workspaces", description: "mobile.workspacesDescription", icon: Building2 },
    { to: "/settings", title: "platform:navigation.settings", description: "mobile.settingsDescription", icon: Settings },
  ];
  if (policy.data?.billing_enabled) workspaceEntries.push({ to: "/subscription", title: "platform:navigation.subscription", description: "mobile.subscriptionDescription", icon: CreditCard });
  return <section className="mobile-hub-page mobile-more-page">
    <PageHeader title={t("mobile.more")} description={t("mobile.moreDescription")} />
    <Link className="mobile-profile-link" to="/account"><span className="avatar">{(user?.name ?? "U").slice(0, 1)}</span><span><strong>{user?.name}</strong><small>{current?.name}</small></span><ChevronRight size={20} /></Link>
    <section className="mobile-hub-section"><h2>{t("mobile.workspaceSection")}</h2><Entries items={workspaceEntries} /></section>
    <section className="mobile-hub-section"><h2>{t("mobile.exploreSection")}</h2><Entries items={[
      { to: "/device-map", title: "platform:navigation.deviceMap", description: "mobile.mapDescription", icon: MapPinned },
      { to: "/atlas", title: "platform:navigation.wallboards", description: "mobile.atlasDescription", icon: Globe2 },
      { to: "/atlas/topics/digital-plot", title: "mobile.digitalPlot", description: "mobile.plotDescription", icon: Leaf },
    ]} /></section>
    <section className="mobile-hub-section"><h2>{t("mobile.preferencesSection")}</h2><Entries items={[{ to: "/account", title: "platform:navigation.account", description: "mobile.accountDescription", icon: ShieldCheck }]} />
      <div className="mobile-preference-row"><span>{t("language")}</span><LanguageSwitcher compact /></div>
      <label className="mobile-preference-row"><span>{t("mobile.theme")}</span><SelectInput aria-label={t("mobile.theme")} value={theme} onValueChange={value => setTheme(value as "system" | "light" | "dark")}><option value="system">{t("themeSystem")}</option><option value="light">{t("themeLight")}</option><option value="dark">{t("themeDark")}</option></SelectInput></label>
      <button type="button" className="mobile-help-action" onClick={openGuide}><HelpCircle size={20} /><span>{t("mobile.openGuide")}</span><ChevronRight size={18} /></button>
    </section>
    <Button className="mobile-sign-out" variant="secondary" disabled={busy} onClick={async () => { setBusy(true); try { await signOut(); } finally { setBusy(false); } }}><LogOut size={18} />{t(busy ? "mobile.signingOut" : "mobile.signOut")}</Button>
  </section>;
}
