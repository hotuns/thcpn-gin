import { Typography } from "antd";
import type { TableColumnsType } from "antd";

export function statusColor(status?: string): string {
  switch (status) {
    case "active":
    case "success":
    case "ok":
    case "published":
      return "success";
    case "pending":
    case "running":
    case "draft":
      return "processing";
    case "archived":
    case "expired":
    case "retired":
    case "disabled":
      return "warning";
    case "failed":
    case "revoked":
    case "failure":
      return "error";
    default:
      return "default";
  }
}

export function copyableId(value?: string) {
  if (!value) {
    return <span className="muted">-</span>;
  }

  return (
    <Typography.Text className="copyable-id mono" copyable={{ text: value, tooltips: ["复制 ID", "已复制"] }} ellipsis title={value}>
      {value}
    </Typography.Text>
  );
}

export function tableScrollX<T>(columns: TableColumnsType<T>): number {
  return columns.reduce((sum, column) => sum + numericColumnWidth(column.width, String(column.key ?? "")), 0);
}

function numericColumnWidth(width: unknown, key: string): number {
  if (typeof width === "number") {
    return width;
  }
  if (key === "id" || key.endsWith("_id") || key === "request" || key === "resource") {
    return 240;
  }
  if (key === "actions" || key === "action" || key === "status" || key === "result") {
    return 130;
  }
  if (key === "created" || key === "updated" || key === "expires" || key === "time") {
    return 180;
  }
  if (key === "name" || key === "subject" || key === "target" || key === "user") {
    return 220;
  }
  return 170;
}
