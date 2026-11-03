import { type Dataset, type JsonRecord } from "@thcpn/api";

export type SourceInput = {
  source_type: Dataset["sources"][number]["source_type"];
  source_id: string;
};

export function selectDatasetStreams(current: SourceInput[], ids: string[], checked: boolean): SourceInput[] {
  if (!checked) return current.filter(source => source.source_type !== "data_stream" || !ids.includes(source.source_id));
  return [...current, ...[...new Set(ids)].filter(id => !current.some(source => source.source_type === "data_stream" && source.source_id === id)).map(source_id => ({ source_type: "data_stream" as const, source_id }))];
}

export type AddableSourceType = Extract<
  SourceInput["source_type"],
  "device" | "data_stream"
>;

export type DatasetDraft = {
  workspaceId: string;
  projectId: string;
  name: string;
  description: string;
  dataType: string;
  startTime: string;
  endTime: string;
  sources: SourceInput[];
  status?: string;
};

export type DatasetPrefill = {
  name: string;
  startTime: string;
  endTime: string;
  sources: SourceInput[];
};

export const datasetDeviceSystem = (item?: JsonRecord) => {
  const type = String(item?.device_type ?? "");
  return type === "standalone" ? "standard" : type === "gateway_node" ? "group" : "";
};

export const localTime = (input: Date | string) => {
  const date = new Date(input);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
    .toISOString()
    .slice(0, 16);
};

export const buildDatasetPayload = (
  draft: DatasetDraft,
  editing = false,
): JsonRecord => ({
  ...(!editing
    ? {
        workspace_id: draft.workspaceId,
        ...(draft.projectId ? { project_id: draft.projectId } : {}),
      }
    : {}),
  name: draft.name.trim(),
  description: draft.description.trim(),
  data_type: draft.dataType,
  time_start: new Date(draft.startTime).toISOString(),
  time_end: new Date(draft.endTime).toISOString(),
  sources: draft.sources.map(({ source_type, source_id }) => ({
    source_type,
    source_id,
  })),
  ...(editing && draft.status ? { status: draft.status } : {}),
});

export const datasetDetailPath = (datasetId: string) =>
  `/datasets/${encodeURIComponent(datasetId)}`;

export const datasetEditPath = (datasetId: string) =>
  `${datasetDetailPath(datasetId)}/edit`;
