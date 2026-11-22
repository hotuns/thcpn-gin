import type { LucideIcon } from "lucide-react";
import "./summary-cards.css";

type SummaryItem = {
  label: string;
  value: number | string;
  icon: LucideIcon;
  tone?: "running" | "success" | "failed";
};

export function SummaryCards({ items, onboarding }: { items: SummaryItem[]; onboarding: string }) {
  return (
    <div className="summary-cards" data-onboarding={onboarding}>
      {items.map(({ label, value, icon: Icon, tone }) => (
        <div key={label}>
          <span className="summary-cards-icon" data-tone={tone} aria-hidden="true"><Icon size={16} /></span>
          <span className="summary-cards-text">
            <small>{label}</small>
            <strong>{value}</strong>
          </span>
        </div>
      ))}
    </div>
  );
}
