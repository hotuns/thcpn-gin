


export const text = (value: unknown, fallback = "—") =>
  value === undefined || value === null || value === ""
    ? fallback
    : String(value);
export const resourceKindLabel = (kind: "Project" | "Site") =>
  kind === "Project" ? "项目" : "样地";
