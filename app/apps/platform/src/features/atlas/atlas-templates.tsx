import { useLocale } from "@thcpn/i18n";
import type { AtlasConfig } from "@thcpn/api";
import { Button } from "../../shared/ui";

export type AtlasPresentation = NonNullable<AtlasConfig["presentation"]>;

type AtlasTemplate = {
  id: AtlasPresentation;
  titleKey: string;
  descriptionKey: string;
  initialTab: "metrics" | "images";
};

/** Single flagship spatial observatory template; legacy saved presentations map here automatically. */
export const atlasTemplates: readonly AtlasTemplate[] = [
  {
    id: "deep-blue",
    titleKey: "templateDeepBlue",
    descriptionKey: "templateDeepBlueHint",
    initialTab: "metrics",
  },
];

export function atlasTemplate(_id?: string) {
  return atlasTemplates[0];
}

export function AtlasTemplatePreview({ id }: { id: AtlasPresentation }) {
  return (
    <span className={`atlas-template-preview preview-${atlasTemplate(id).id} preview-observatory`} aria-hidden="true">
      <svg viewBox="0 0 320 180" fill="none" xmlns="http://www.w3.org/2000/svg" className="preview-observatory-svg">
        <defs>
          <radialGradient id="obs-prev-bg" cx="52%" cy="48%" r="72%">
            <stop offset="0%" stopColor="#132c33" />
            <stop offset="55%" stopColor="#0b1720" />
            <stop offset="100%" stopColor="#060c12" />
          </radialGradient>
          <linearGradient id="obs-prev-arc" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#38bdf8" stopOpacity="0.9" />
            <stop offset="100%" stopColor="#34d399" stopOpacity="0.95" />
          </linearGradient>
          <linearGradient id="obs-prev-chart" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="#34d399" stopOpacity="0.4" />
            <stop offset="100%" stopColor="#34d399" stopOpacity="0.02" />
          </linearGradient>
        </defs>
        <rect width="320" height="180" fill="url(#obs-prev-bg)" />
        {/* Subtle terrain contour rings */}
        <ellipse cx="164" cy="96" rx="112" ry="48" stroke="#34d399" strokeOpacity="0.12" strokeWidth="1" />
        <ellipse cx="164" cy="96" rx="76" ry="32" stroke="#38bdf8" strokeOpacity="0.16" strokeWidth="1" />
        <ellipse cx="164" cy="96" rx="42" ry="18" stroke="#34d399" strokeOpacity="0.22" strokeWidth="1" />
        {/* Animated-style LoRa topology arcs */}
        <path d="M120 108 Q144 64 168 88" stroke="url(#obs-prev-arc)" strokeWidth="1.6" strokeLinecap="round" />
        <path d="M206 106 Q186 68 168 88" stroke="url(#obs-prev-arc)" strokeWidth="1.6" strokeLinecap="round" />
        <path d="M150 124 Q160 102 168 88" stroke="url(#obs-prev-arc)" strokeWidth="1.3" strokeOpacity="0.8" />
        <circle cx="168" cy="88" r="10" fill="#34d399" fillOpacity="0.18" stroke="#34d399" strokeWidth="1.2" />
        <circle cx="168" cy="88" r="3.5" fill="#ecfdf5" />
        <circle cx="120" cy="108" r="3" fill="#38bdf8" />
        <circle cx="206" cy="106" r="3" fill="#34d399" />
        <circle cx="150" cy="124" r="2.5" fill="#fbbf24" />
        {/* Top floating command capsule */}
        <rect x="14" y="10" width="292" height="20" rx="10" fill="#091119" fillOpacity="0.82" stroke="#ffffff" strokeOpacity="0.14" />
        <circle cx="26" cy="20" r="3" fill="#34d399" />
        <rect x="35" y="17.5" width="44" height="5" rx="2.5" fill="#e2e8f0" fillOpacity="0.75" />
        <rect x="112" y="16" width="26" height="8" rx="4" fill="#34d399" fillOpacity="0.18" />
        <rect x="144" y="16" width="26" height="8" rx="4" fill="#38bdf8" fillOpacity="0.18" />
        <rect x="176" y="16" width="26" height="8" rx="4" fill="#fbbf24" fillOpacity="0.18" />
        <rect x="266" y="17" width="30" height="6" rx="3" fill="#ffffff" fillOpacity="0.14" />
        {/* Left floating station deck */}
        <rect x="14" y="38" width="76" height="128" rx="10" fill="#091119" fillOpacity="0.78" stroke="#ffffff" strokeOpacity="0.12" />
        <rect x="21" y="46" width="62" height="10" rx="5" fill="#ffffff" fillOpacity="0.08" />
        <rect x="22" y="47" width="22" height="8" rx="4" fill="#34d399" fillOpacity="0.35" />
        <rect x="21" y="62" width="62" height="4" rx="2" fill="#34d399" fillOpacity="0.45" />
        <rect x="21" y="74" width="62" height="16" rx="5" fill="#34d399" fillOpacity="0.14" stroke="#34d399" strokeOpacity="0.4" />
        <rect x="21" y="95" width="62" height="14" rx="5" fill="#ffffff" fillOpacity="0.05" />
        <rect x="21" y="114" width="62" height="14" rx="5" fill="#ffffff" fillOpacity="0.05" />
        <rect x="21" y="133" width="62" height="14" rx="5" fill="#ffffff" fillOpacity="0.04" />
        {/* Right floating observation deck */}
        <rect x="222" y="38" width="84" height="128" rx="10" fill="#091119" fillOpacity="0.78" stroke="#ffffff" strokeOpacity="0.12" />
        <rect x="229" y="46" width="32" height="22" rx="6" fill="#34d399" fillOpacity="0.14" stroke="#34d399" strokeOpacity="0.35" />
        <rect x="265" y="46" width="34" height="22" rx="6" fill="#ffffff" fillOpacity="0.06" />
        <rect x="229" y="72" width="32" height="22" rx="6" fill="#ffffff" fillOpacity="0.06" />
        <rect x="265" y="72" width="34" height="22" rx="6" fill="#ffffff" fillOpacity="0.06" />
        {/* Mini trend chart */}
        <path d="M230 128 C242 124 248 110 262 114 C276 118 282 104 298 106 L298 134 L230 134 Z" fill="url(#obs-prev-chart)" />
        <path d="M230 128 C242 124 248 110 262 114 C276 118 282 104 298 106" stroke="#34d399" strokeWidth="1.5" />
        {/* Mini imagery row */}
        <rect x="229" y="140" width="32" height="19" rx="4" fill="#1e3a46" />
        <rect x="266" y="140" width="33" height="19" rx="4" fill="#1b342d" />
        {/* Bottom-center map dock */}
        <rect x="116" y="148" width="88" height="18" rx="9" fill="#091119" fillOpacity="0.82" stroke="#ffffff" strokeOpacity="0.14" />
        <circle cx="132" cy="157" r="3" fill="#e2e8f0" fillOpacity="0.7" />
        <circle cx="148" cy="157" r="3" fill="#34d399" />
        <circle cx="164" cy="157" r="3" fill="#38bdf8" />
        <rect x="176" y="155" width="18" height="4" rx="2" fill="#ffffff" fillOpacity="0.28" />
      </svg>
    </span>
  );
}

export function AtlasTemplateChoices({
  value,
  onChange,
}: {
  value?: string;
  onChange: (id: AtlasPresentation) => void;
}) {
  const { t } = useLocale();
  if (atlasTemplates.length <= 1) return null;
  return (
    <div
      className="atlas-template-choices"
      role="group"
      aria-label={t("atlas.chooseTemplate")}
    >
      {atlasTemplates.map((template) => (
        <Button
          key={template.id}
          variant="ghost"
          className={`atlas-template-card ${atlasTemplate(value).id === template.id ? "is-selected" : ""}`}
          aria-pressed={atlasTemplate(value).id === template.id}
          onClick={() => onChange(template.id)}
        >
          <AtlasTemplatePreview id={template.id} />
          <strong>{t(`atlas.${template.titleKey}`)}</strong>
          <span>{t(`atlas.${template.descriptionKey}`)}</span>
        </Button>
      ))}
    </div>
  );
}
