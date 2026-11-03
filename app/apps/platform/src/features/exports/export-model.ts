import { type DeviceNodeTarget, type ExportJob, type JsonRecord } from "@thcpn/api";
import { type PickerOption } from "../../shared/ui";

export type ResourceType = "device" | "data_stream" | "dataset" | "media";

export type ExportDraft = {
  resourceType: ResourceType;
  resourceId: string;
  exportType: string;
  startTime: string;
  endTime: string;
  limit: number;
  mediaType: string;
  expiresAt: string;
};

export type ExportSystem = "standard" | "group" | "carbon";

const localTime = (input: Date | string) => {
  const date = new Date(input);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
    .toISOString()
    .slice(0, 16);
};

export const defaultRange = () => ({
  start: localTime(new Date(Date.now() - 7 * 86_400_000)),
  end: localTime(new Date()),
});

export const value = (item: JsonRecord, key: string) => String(item[key] ?? "");

export const pickerOptions = (items: JsonRecord[]): PickerOption[] =>
  items.map((item) => ({
    id: value(item, "id"),
    label: value(item, "name"),
    description: value(item, "serial_no"),
    searchText: Array.isArray(item.research_tags) ? item.research_tags.join(" ") : "",
  }));

export const arrayParam = (input: string | null) =>
  input
    ?.split(",")
    .map((item) => item.trim())
    .filter(Boolean) ?? [];

export const exportTypesFor = (resource: ResourceType) =>
  resource === "dataset"
    ? ["dataset_zip"]
    : resource === "media"
      ? ["media_zip"]
      : ["telemetry_csv", "telemetry_excel", "media_zip"];

export const buildExportPayload = (draft: ExportDraft): JsonRecord => ({
  resource_type: draft.resourceType,
  resource_id: draft.resourceId,
  export_type: draft.exportType,
  ...(draft.exportType !== "dataset_zip"
    ? {
        start_time: new Date(draft.startTime).toISOString(),
        end_time: new Date(draft.endTime).toISOString(),
        limit: draft.limit,
      }
    : {}),
  ...(draft.exportType === "media_zip" && draft.mediaType
    ? { request_config: { media_type: draft.mediaType } }
    : {}),
  ...(draft.expiresAt
    ? { expires_at: new Date(draft.expiresAt).toISOString() }
    : {}),
});

export const canDownloadExport = (
  job: Pick<ExportJob, "status" | "expires_at">,
  now = Date.now(),
) => job.status === "success" && Date.parse(job.expires_at) > now;

export function buildGroupExportPayload({
  nodeTargets, gateway, start, end, lorawan, images, data, status,
}: {
  nodeTargets: DeviceNodeTarget[];
  gateway: { id: string; name: string };
  start: string;
  end: string;
  lorawan: boolean;
  images: boolean;
  data: boolean;
  status: boolean;
}): JsonRecord {
  const ids = [...new Set(nodeTargets.map((target) => target.kind === "device" ? target.device_id : target.gateway_device_id))];
  if (!ids.length && lorawan && status) ids.push(gateway.id);
  const payload = buildBatchExportPayload("group", ids, start, end, !lorawan && images, gateway, data);
  if (lorawan) (payload.request_config as JsonRecord).include_status = status;
  (payload.request_config as JsonRecord).node_targets = nodeTargets;
  return payload;
}

export function buildCarbonExportPayload({
  deviceId, nodeIds, fields, start, end, flux, raw,
}: {
  deviceId: string;
  nodeIds: number[];
  fields: string[];
  start: string;
  end: string;
  flux: boolean;
  raw: boolean;
}): JsonRecord {
  return {
    resource_type: "device",
    resource_id: deviceId,
    export_type: "carbon_station_zip",
    request_config: {
      node_ids: nodeIds,
      fields,
      start_time: new Date(start).toISOString(),
      end_time: new Date(end).toISOString(),
      include_flux: flux,
      include_raw_samples: raw,
    },
  };
}

export function buildBatchExportPayload(
  system: "standard" | "group",
  deviceIds: string[],
  startTime: string,
  endTime: string,
  includeImages = true,
  group?: { id: string; name: string },
  includeData = true,
): JsonRecord {
  return {
    resource_type: "device_batch",
    resource_id: deviceIds[0],
    export_type: system === "group" ? "group_site_zip" : "standard_station_zip",
    request_config: {
      device_ids: deviceIds,
      start_time: new Date(startTime).toISOString(),
      end_time: new Date(endTime).toISOString(),
      include_data: includeData,
      include_images: includeImages,
      ...(group ? { gateway_id: group.id, gateway_name: group.name } : {}),
    },
  };
}
