import BorderBox13 from "./vendor/datav/border-box-13";
import Decoration5 from "./vendor/datav/decoration-5";
import Decoration8 from "./vendor/datav/decoration-8";
import Decoration11 from "./vendor/datav/decoration-11";

const steel = ["#3975a5", "#83d9ff"] as const;
const accent = ["#43baff", "#e6be73"] as const;

/** DataV ornaments are presentation-only; business controls remain outside them. */
export function ObservatoryMasthead() {
  return <div className="obs-masthead" aria-hidden="true">
    <Decoration8 className="obs-wing obs-wing-left" color={steel} reverse />
    <Decoration8 className="obs-wing obs-wing-right" color={steel} />
    <Decoration5 className="obs-masthead-base" color={accent} />
    <span className="obs-scan-track" />
    <span className="obs-signal-bars"><i /><i /><i /><i /><i /></span>
  </div>;
}

export function ObservatoryTitle({ title, description, className = "" }: {
  title: string; description?: string; className?: string;
}) {
  const subtitle = description?.trim();
  return <div className={`obs-title ${className}`}>
    <Decoration11 className="obs-title-frame" color={accent}>
      <div className="obs-title-copy">
        {subtitle && <span className="obs-title-eyebrow" title={subtitle}>{subtitle}</span>}
        <h1 title={title} aria-label={title}><span className="t-shimmer" data-text={title} aria-hidden="true">{title}</span></h1>
      </div>
    </Decoration11>
  </div>;
}

export function ObservatoryPanelFrame() {
  return <div className="obs-panel-frame" aria-hidden="true"><BorderBox13 color={steel} /><span className="obs-panel-current" /></div>;
}
