export type InspectionKind = "late" | "missing" | "range" | "invalid" | "zero";
export type InspectionMetric = { family: string; metric_code: string; unit: string; name: string };
export type InspectionTemplate = Omit<InspectionMetric, "name"> & {
  id?: string; device_type: string; kind: "range" | "invalid" | "zero"; consecutive: number; enabled: boolean;
  lower_value?: number | null; upper_value?: number | null; invalid_value?: number | null;
};
export type InspectionDevice = {
  device_id: string; name: string; asset_no: string; family: string;
  checked_at: string | null; latest_sample_at: string | null; schedule_known: boolean; overdue: boolean; error: string;
};
export type InspectionEvent = {
  id: string; device_id: string; device_name: string; asset_no: string; family: string;
  kind: InspectionKind; metric: string; data_stream_id: string | null; node_index: number | null; detail: string;
  started_at: string; last_seen_at: string; resolved_at: string | null;
  acknowledged_at: string | null; acknowledged_by: string; note: string;
};
export type InspectionOverview = {
  date: string;
  counts: { eligible: number; checked: number; unknown_schedule: number; overdue: number; failed: number; new_events: number; resolved_events: number; unacknowledged: number };
};
