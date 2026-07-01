export function formatDateTime(value?: string): string {
  if (!value) {
    return "-";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return new Intl.DateTimeFormat("zh-CN", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(date);
}

export function compactNumber(value: number): string {
  return new Intl.NumberFormat("zh-CN").format(value);
}

export function labelOrDash(value?: string | number | null): string {
  if (value === undefined || value === null || value === "") {
    return "-";
  }
  return String(value);
}
