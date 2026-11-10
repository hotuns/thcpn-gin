import dayjs, { type Dayjs } from "dayjs";

export function inspectionRange(params: URLSearchParams, fallbackHours: number): [Dayjs, Dayjs] {
  const start = dayjs(params.get("start") ?? "");
  const end = dayjs(params.get("end") ?? "");
  if (start.isValid() && end.isValid() && end.isAfter(start)) return [start, end];
  const now = dayjs();
  return [now.subtract(fallbackHours, "hour"), now];
}
