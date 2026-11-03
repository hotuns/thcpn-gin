import { useEffect, useLayoutEffect, useMemo, useState, type ComponentType } from "react";
import { BarChart3, Boxes, Building2, Database, Download, MapPinned, ScanLine, Workflow, X } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import { useLocale } from "@thcpn/i18n";

type TourModuleId = "claim" | "deviceData" | "map" | "compare" | "datasets" | "processing" | "exports" | "organization";
type TourStep = { route: string; selector?: string; routeFromSelector?: string; title: string; description: string };
type TourModule = { id: TourModuleId; icon: ComponentType<{ size?: number }>; title: string; description: string; steps: TourStep[] };

const moduleDefinitions: Array<{ id: TourModuleId; icon: TourModule["icon"]; routes: string[]; selectors: string[]; dynamic?: number }> = [
  { id: "claim", icon: ScanLine, routes: ["/devices", "/devices", "/claim", "/claim"], selectors: ['[data-onboarding="device-list"]', '[data-onboarding="claim-entry"]', '[data-onboarding="claim-identity"]', '[data-onboarding="claim-assignment"]'] },
  { id: "deviceData", icon: Boxes, routes: ["/devices", "/devices", "", ""], selectors: ['[data-onboarding="device-filters"]', '[data-onboarding="device-data-entry"]', '[data-onboarding="device-tabs"]', '[data-onboarding="device-query"]'], dynamic: 2 },
  { id: "map", icon: MapPinned, routes: ["/device-map"], selectors: ['[data-onboarding="map-canvas"]', '[data-onboarding="map-filters"]', '[data-onboarding="map-summary"]'] },
  { id: "compare", icon: BarChart3, routes: ["/data-compare"], selectors: ['[data-onboarding="comparison-conditions"]', '[data-onboarding="comparison-add"]', '[data-onboarding="comparison-results"]'] },
  { id: "datasets", icon: Database, routes: ["/datasets", "/datasets", "/datasets/new", "/datasets/new"], selectors: ['[data-onboarding="dataset-list"]', '[data-onboarding="dataset-create"]', '[data-onboarding="dataset-sources"]', '[data-onboarding="dataset-save"]'] },
  { id: "processing", icon: Workflow, routes: ["/processing"], selectors: ['[data-onboarding="processing-create"]', '[data-onboarding="processing-summary"]', '[data-onboarding="processing-list"]'] },
  { id: "exports", icon: Download, routes: ["/exports"], selectors: ['[data-onboarding="export-create"]', '[data-onboarding="export-summary"]', '[data-onboarding="export-list"]'] },
  { id: "organization", icon: Building2, routes: ["/workspaces", "/settings?tab=resources", "/settings?tab=access", "/settings?tab=audit"], selectors: ['[data-onboarding="organization-list"]', '[data-onboarding="organization-resources"]', '[data-onboarding="organization-access"]', '[data-onboarding="organization-audit"]'] },
];

export function OnboardingTour({ userId, startOpen = false }: { userId: string; startOpen?: boolean }) {
  const { t } = useLocale();
  const navigate = useNavigate();
  const location = useLocation();
  const storageKey = `ecocloud:onboarding-completed:${userId}`;
  const [moduleId, setModuleId] = useState<TourModuleId | null>(null);
  const [step, setStep] = useState(-1);
  const [open, setOpen] = useState(() => startOpen || localStorage.getItem(storageKey) !== "true");
  const [target, setTarget] = useState<DOMRect | null>(null);
  const modules: TourModule[] = useMemo(() => moduleDefinitions.map((definition) => ({
    id: definition.id,
    icon: definition.icon,
    title: t(`platform:onboarding.modules.${definition.id}.title`),
    description: t(`platform:onboarding.modules.${definition.id}.description`),
    steps: definition.selectors.map((selector, index) => ({
      route: definition.routes[index] ?? definition.routes[0],
      routeFromSelector: definition.dynamic === index ? '[data-onboarding="device-data-entry"]' : undefined,
      selector,
      title: t(`platform:onboarding.modules.${definition.id}.steps.${index}.title`),
      description: t(`platform:onboarding.modules.${definition.id}.steps.${index}.description`),
    })),
  })), [t]);
  const currentModule = modules.find((item) => item.id === moduleId);
  const current = currentModule?.steps[step];
  const dismiss = () => {
    localStorage.setItem(storageKey, "true");
    setOpen(false);
  };
  const selectModule = (item: TourModule) => {
    localStorage.setItem(storageKey, "true");
    setModuleId(item.id);
    setStep(0);
    navigate(item.steps[0].route);
  };
  const goToStep = (next: number) => {
    if (!currentModule) return;
    const nextStep = currentModule.steps[next];
    let route = nextStep.route;
    if (nextStep.routeFromSelector) route = document.querySelector<HTMLElement>(nextStep.routeFromSelector)?.dataset.onboardingRoute ?? "";
    setStep(next);
    if (route && `${location.pathname}${location.search}` !== route) navigate(route);
  };

  useLayoutEffect(() => {
    if (!open || !current) return;
    let frame = 0;
    let attempts = 0;
    const update = () => {
      const element = current.selector ? document.querySelector<HTMLElement>(current.selector) : null;
      if (element) {
        element.scrollIntoView({ block: "center", behavior: attempts ? "smooth" : "auto" });
        setTarget(element.getBoundingClientRect());
        return;
      }
      setTarget(null);
      if (attempts++ < 30) frame = window.requestAnimationFrame(update);
    };
    frame = window.requestAnimationFrame(update);
    const refresh = () => setTarget(current.selector ? document.querySelector<HTMLElement>(current.selector)?.getBoundingClientRect() ?? null : null);
    window.addEventListener("resize", refresh);
    window.addEventListener("scroll", refresh, true);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", refresh);
      window.removeEventListener("scroll", refresh, true);
    };
  }, [current, location.pathname, location.search, open]);

  useEffect(() => {
    if (!open) return;
    const close = (event: KeyboardEvent) => event.key === "Escape" && dismiss();
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [open]);

  if (!open) return null;
  if (!currentModule || !current) return <div className="onboarding-tour" role="dialog" aria-modal="true" aria-label={t("platform:onboarding.title")}>
    <div className="onboarding-backdrop" />
    <section className="onboarding-directory">
      <button type="button" className="onboarding-close" aria-label={t("platform:onboarding.close")} onClick={dismiss}><X size={17} /></button>
      <span className="onboarding-step">{t("platform:onboarding.eyebrow")}</span>
      <h2>{t("platform:onboarding.title")}</h2>
      <p>{t("platform:onboarding.introduction")}</p>
      <div className="onboarding-module-grid">
        {modules.map((item) => <button type="button" key={item.id} onClick={() => selectModule(item)}><span><item.icon size={19} /></span><strong>{item.title}</strong><small>{item.description}</small></button>)}
      </div>
      <button type="button" className="onboarding-directory-skip" onClick={dismiss}>{t("platform:onboarding.later")}</button>
    </section>
  </div>;

  const bubbleStyle = target ? { top: Math.min(Math.max(16, target.top), window.innerHeight - 260), left: target.right + 360 < window.innerWidth ? target.right + 18 : Math.max(16, target.left - 358) } : undefined;
  return <div className="onboarding-tour" role="dialog" aria-modal="true" aria-label={t("platform:onboarding.title")}>
    <div className="onboarding-backdrop" />
    {target ? <div className="onboarding-target" style={{ top: target.top - 5, left: target.left - 5, width: target.width + 10, height: target.height + 10 }} /> : null}
    <section className={`onboarding-bubble ${target ? "is-targeted" : ""}`} style={bubbleStyle}>
      <button type="button" className="onboarding-close" aria-label={t("platform:onboarding.close")} onClick={dismiss}><X size={17} /></button>
      <span className="onboarding-step">{currentModule.title} · {step + 1} / {currentModule.steps.length}</span>
      <h2>{current.title}</h2><p>{current.description}</p>
      {!target && current.selector ? <small className="onboarding-unavailable">{t("platform:onboarding.unavailable")}</small> : null}
      <div className="onboarding-actions">
        <button type="button" className="onboarding-skip" onClick={dismiss}>{t("platform:onboarding.exit")}</button>
        <div>
          {step > 0 ? <button type="button" className="onboarding-secondary" onClick={() => goToStep(step - 1)}>{t("platform:onboarding.previous")}</button> : null}
          {step === currentModule.steps.length - 1 ? <button type="button" className="onboarding-primary" onClick={dismiss}>{t("platform:onboarding.finish")}</button> : <button type="button" className="onboarding-primary" onClick={() => goToStep(step + 1)}>{t("platform:onboarding.next")}</button>}
        </div>
      </div>
    </section>
  </div>;
}
