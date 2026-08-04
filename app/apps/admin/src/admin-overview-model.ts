export const formatOverviewTime = (input: unknown, locale = "zh-CN") => {
  if (input === undefined || input === null || input === "") return "—";
  const date = input instanceof Date
    ? input
    : new Date(typeof input === "number" ? input : String(input));
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat(locale, {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(date);
};
