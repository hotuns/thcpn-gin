import { Tag } from "antd";
import type { ReactNode } from "react";

type BadgeTone = "neutral" | "success" | "warning" | "danger" | "info";

export function Badge({ children, tone = "neutral" }: { children: ReactNode; tone?: BadgeTone }) {
  return <Tag color={tagColor(tone)}>{children}</Tag>;
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

function tagColor(tone: BadgeTone): string | undefined {
  switch (tone) {
    case "success":
      return "success";
    case "warning":
      return "warning";
    case "danger":
      return "error";
    case "info":
      return "processing";
    default:
      return "default";
  }
}
