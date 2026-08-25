import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import i18next, { createInstance, type i18n, type TFunction } from "i18next";
import { I18nextProvider, useTranslation } from "react-i18next";
import { Languages } from "lucide-react";
import { resources } from "./resources";
import { translateLegacyText } from "./legacy";

export type SupportedLocale = "zh-CN" | "en-US";
export type ThemeMode = "system" | "light" | "dark";
export const localeStorageKey = "thcpn.locale";
export const themeStorageKey = "thcpn.theme";
export const supportedLocales: SupportedLocale[] = ["zh-CN", "en-US"];
export const supportedThemeModes: ThemeMode[] = ["system", "light", "dark"];

export const normalizeLocale = (value?: string | null): SupportedLocale =>
  value?.toLowerCase().startsWith("zh") ? "zh-CN" : "en-US";

export const detectLocale = (): SupportedLocale => {
  if (typeof window === "undefined") return "zh-CN";
  const stored = window.localStorage.getItem(localeStorageKey);
  if (stored && supportedLocales.includes(stored as SupportedLocale)) return stored as SupportedLocale;
  return normalizeLocale(window.navigator.languages?.[0] ?? window.navigator.language);
};

export const detectTheme = (): ThemeMode => {
  if (typeof window === "undefined") return "system";
  const stored = window.localStorage.getItem(themeStorageKey);
  return stored && supportedThemeModes.includes(stored as ThemeMode) ? stored as ThemeMode : "system";
};

const instance = createInstance();
void instance.init({
  resources,
  lng: detectLocale(),
  fallbackLng: "zh-CN",
  defaultNS: "common",
  interpolation: { escapeValue: false },
  returnNull: false,
  showSupportNotice: false,
});

const LocaleContext = createContext(instance);
const ThemeContext = createContext<{ theme: ThemeMode; resolvedTheme: "light" | "dark"; setTheme: (theme: ThemeMode) => void }>({ theme: "system", resolvedTheme: "light", setTheme: () => undefined });

export function I18nProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<ThemeMode>(detectTheme);
  const [systemTheme, setSystemTheme] = useState<"light" | "dark">(() => typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
  const resolvedTheme = theme === "system" ? systemTheme : theme;
  const setTheme = (next: ThemeMode) => {
    window.localStorage.setItem(themeStorageKey, next);
    setThemeState(next);
  };
  useEffect(() => {
    const update = (language: string) => {
      const locale = normalizeLocale(language);
      document.documentElement.lang = locale;
      document.documentElement.dir = "ltr";
      document.title = instance.t("appTitle", { lng: locale });
    };
    update(instance.language);
    instance.on("languageChanged", update);
    const syncStorage = (event: StorageEvent) => {
      if (event.key === localeStorageKey && event.newValue && supportedLocales.includes(event.newValue as SupportedLocale)) void instance.changeLanguage(event.newValue);
      if (event.key === themeStorageKey && event.newValue && supportedThemeModes.includes(event.newValue as ThemeMode)) setThemeState(event.newValue as ThemeMode);
    };
    window.addEventListener("storage", syncStorage);
    return () => { instance.off("languageChanged", update); window.removeEventListener("storage", syncStorage); };
  }, []);
  useEffect(() => {
    document.documentElement.dataset.theme = resolvedTheme;
    document.documentElement.style.colorScheme = resolvedTheme;
  }, [resolvedTheme]);
  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = (event: MediaQueryListEvent) => setSystemTheme(event.matches ? "dark" : "light");
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);
  useEffect(() => {
    if (typeof document === "undefined") return;
    const originals = new WeakMap<Node, string>();
    const attributeOriginals = new WeakMap<Element, Map<string, string>>();
    const attributes = ["placeholder", "title", "aria-label"];
    const localize = (root: Node) => {
      const english = normalizeLocale(instance.language) === "en-US";
      const visit = (node: Node) => {
        if (node.nodeType === Node.TEXT_NODE) {
          const current = node.textContent ?? "";
          const source = originals.get(node) ?? current;
          const trimmed = source.trim();
          const translated = english ? translateLegacyText(trimmed) : trimmed;
          if (translated !== trimmed) originals.set(node, source);
          const next = source.replace(trimmed, translated);
          if (next !== current) node.textContent = next;
          return;
        }
        if (!(node instanceof Element)) return;
        if (["SCRIPT", "STYLE", "TEXTAREA"].includes(node.tagName)) return;
        for (const name of attributes) {
          const current = node.getAttribute(name);
          if (!current) continue;
          const stored = attributeOriginals.get(node)?.get(name) ?? current;
          const translated = english ? translateLegacyText(stored) : stored;
          if (translated !== stored) {
            const values = attributeOriginals.get(node) ?? new Map<string, string>();
            values.set(name, stored); attributeOriginals.set(node, values);
          }
          if (translated !== current) node.setAttribute(name, translated);
        }
        Array.from(node.childNodes).forEach(visit);
      };
      visit(root);
    };
    const observer = new MutationObserver((mutations) => mutations.forEach((mutation) => mutation.addedNodes.forEach(localize)));
    localize(document.body);
    observer.observe(document.body, { childList: true, subtree: true });
    const onLanguage = () => localize(document.body);
    instance.on("languageChanged", onLanguage);
    return () => { observer.disconnect(); instance.off("languageChanged", onLanguage); };
  }, []);
  return <LocaleContext.Provider value={instance}><ThemeContext.Provider value={{ theme, resolvedTheme, setTheme }}><I18nextProvider i18n={instance}>{children}</I18nextProvider></ThemeContext.Provider></LocaleContext.Provider>;
}

export function useTheme() {
  return useContext(ThemeContext);
}

export function useLocale() {
  const current = useContext(LocaleContext);
  const { t } = useTranslation(["common", "platform", "admin", "public"]);
  const locale = normalizeLocale(current.resolvedLanguage ?? current.language);
  return useMemo(() => ({
    locale,
    t,
    setLocale: async (next: SupportedLocale) => {
      window.localStorage.setItem(localeStorageKey, next);
      await current.changeLanguage(next);
    },
    formatDateTime: (value?: string | number | Date | null, options?: Intl.DateTimeFormatOptions) => value ? new Intl.DateTimeFormat(locale, options ?? { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)) : "—",
    formatDate: (value?: string | number | Date | null, options?: Intl.DateTimeFormatOptions) => value ? new Intl.DateTimeFormat(locale, options ?? { dateStyle: "medium" }).format(new Date(value)) : "—",
    formatNumber: (value: number, options?: Intl.NumberFormatOptions) => new Intl.NumberFormat(locale, options).format(value),
  }), [current, locale, t]);
}

export function LanguageSwitcher({ compact = false }: { compact?: boolean }) {
  const { locale, setLocale, t } = useLocale();
  return <div className={`language-switcher${compact ? " compact" : ""}`} role="group" aria-label={t("language")}>
    {!compact && <Languages size={14} aria-hidden="true" />}
    <button type="button" className={locale === "zh-CN" ? "active" : ""} aria-pressed={locale === "zh-CN"} onClick={() => void setLocale("zh-CN")}>{t("chinese")}</button>
    <button type="button" className={locale === "en-US" ? "active" : ""} aria-pressed={locale === "en-US"} onClick={() => void setLocale("en-US")}>{t("english")}</button>
  </div>;
}

const defaultRoleNames: Record<string, string> = { owner: "Owner", admin: "Admin", project_manager: "Project Manager", site_operator: "Site Operator", data_manager: "Data Manager", researcher: "Researcher", viewer: "Viewer", shared_viewer: "Shared Viewer", shared_downloader: "Shared Downloader", service_engineer: "Service Engineer", custom: "Custom" };

const translated = (t: TFunction, group: string, value?: string, fallback = "—") => value ? t(`${group}.${value}`, { defaultValue: fallback === "—" ? value : fallback }) : fallback;
export const domainLabels = (t: TFunction) => ({
  deviceStatus: (value?: string) => translated(t, "deviceStatus", value),
  lifecycle: (value?: string) => translated(t, "lifecycle", value),
  topology: (value?: string) => translated(t, "topology", value),
  capability: (value?: string) => translated(t, "capability", value, t("capability.fallback")),
  status: (value?: string) => translated(t, "status", value),
  role: (code?: string, fallbackName?: string) => {
    const name = fallbackName?.trim();
    const standard = code ? defaultRoleNames[code] : undefined;
    if (name && (!standard || name.toLowerCase() !== standard.toLowerCase())) return name;
    return translated(t, "role", code, name || "—");
  },
});

export function localizedError(t: TFunction, error: { code?: string; message: string; requestId?: string; status?: number }) {
  const key = error.code ? `errors.${error.code}` : "";
  const message = key && i18next.exists(key, { lng: normalizeLocale(i18next.language) }) ? t(key) : error.message;
  return { ...error, message };
}

export { useTranslation } from "react-i18next";
export type { i18n };
