import type { ReactNode } from "react";

type BadgeTone = "neutral" | "success" | "warning" | "danger" | "info";

export function Badge({ children, tone = "neutral" }: { children: ReactNode; tone?: BadgeTone }) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}

export function statusTone(status?: string): BadgeTone {
  switch (status) {
    case "active":
    case "success":
    case "ok":
    case "published":
      return "success";
    case "pending":
    case "running":
    case "draft":
      return "info";
    case "archived":
    case "expired":
    case "retired":
    case "disabled":
      return "warning";
    case "failed":
    case "revoked":
    case "failure":
      return "danger";
    default:
      return "neutral";
  }
}
