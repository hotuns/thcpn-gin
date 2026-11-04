import { useAuth } from "@thcpn/auth";
import { useEffect, useMemo, useState } from "react";
import { useQueries, useQuery } from "@tanstack/react-query";
import { api, type DeviceMapItem } from "@thcpn/api";
import { workspaceQueryKey } from "@thcpn/workspace";
import { policyLimit } from "../../shared/config/system-policy";
import { defaultMetricIds, preferenceKey, readMetricPreference } from "./atlas-metric-preferences";
import { streamCatalog, timeRange, type AtlasConfig } from "./atlas-model";

export type AtlasDeviceOptions = {
  device: DeviceMapItem;
  workspaceId: string;
  config: AtlasConfig;
  boardId?: string;
  selectedNodeKey?: string;
  onNodeChange?: (key: string) => void;
};

export function useAtlasDevice({ device, workspaceId, config, boardId = "default", selectedNodeKey }: AtlasDeviceOptions) {
  const { user } = useAuth();
  const [tab, setTab] = useState("images");
  const [mediaAvailable, setMediaAvailable] = useState(true);
  const [nodeKey, setNodeKey] = useState(selectedNodeKey ?? "gateway");
  const [chosen, setChosen] = useState<{ key: string; ids: string[] | null } | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [metricDraft, setMetricDraft] = useState<string[]>([]);
  const [preferenceError, setPreferenceError] = useState("");
  const [focusedChart, setFocusedChart] = useState<string | null>(null);
  useEffect(() => { if (selectedNodeKey !== undefined) setNodeKey(selectedNodeKey); }, [selectedNodeKey]);
  const storageKey = preferenceKey(user?.id ?? "anonymous", workspaceId, boardId, device.device_id, nodeKey);
  const savedPreference = useMemo(() => readMetricPreference(storageKey), [storageKey]);
  useEffect(() => { setPickerOpen(false); setPreferenceError(""); setMediaAvailable(true); }, [storageKey]);
  const [range, setRange] = useState(() => timeRange(config.trend_hours ?? 24));
  const [draft, setDraft] = useState(range);
  const [rangeError, setRangeError] = useState(false);
  const streams = useQuery({
    queryKey: workspaceQueryKey(
      workspaceId,
      "atlas",
      device.device_id,
      "streams",
    ),
    queryFn: () => api.dataStreams.list(device.device_id),
    staleTime: 60000,
  });
  const isGateway =
    device.device_type === "gateway";
  const nodes = useQuery({
    queryKey: workspaceQueryKey(
      workspaceId,
      "atlas",
      device.device_id,
      "nodes",
    ),
    queryFn: () => api.devices.nodes(device.device_id),
    enabled: isGateway,
    staleTime: 60000,
  });
  const catalog = useMemo(
    () => streamCatalog(streams.data?.items ?? [], nodes.data?.items ?? []),
    [streams.data, nodes.data],
  );
  const node = nodes.data?.items.find((n) => n.key === nodeKey);
  const metrics = catalog.filter(
    (s) =>
      s.type === "telemetry" &&
      (node ? node.streams.some((n) => n.id === s.id) : (isGateway && nodeKey !== "gateway" ? false : !s.node)),
  );
  const matches = metrics;
  const defaults = defaultMetricIds(metrics, config.metric_defaults?.[`device:${device.device_type}`], config.telemetry_stream_ids);
  const selected = (chosen?.key === storageKey ? chosen.ids ?? defaults : savedPreference ?? defaults).filter(id => metrics.some(stream => stream.id === id));
  const visible = selected.flatMap(id => matches.filter(stream => stream.id === id));
  const chartIds = config.show_trends === false ? [] : [...new Set([...(focusedChart && selected.includes(focusedChart) ? [focusedChart] : []), ...selected])].slice(0, 2);
  const queryStreams = catalog.filter((s) =>
    [...visible.map((s) => s.id), ...chartIds].includes(s.id),
  );
  const queries = useQueries({
    queries: queryStreams.map((stream) => ({
      queryKey: workspaceQueryKey(
        workspaceId,
        "atlas",
        "telemetry",
        stream.id,
        range.start,
        range.end,
      ),
      queryFn: () =>
        api.telemetry.dataStream(stream.id, {
          startTime: range.start,
          endTime: range.end,
          adaptive: true,
          targetPoints: Math.min(300,policyLimit("query_points",5000)),
          limit: Math.min(5000,policyLimit("query_points",5000)),
        }),
      staleTime: 60000,
      retry: false,
    })),
  });
  const results = new Map(
    queryStreams.map((stream, index) => [stream.id, queries[index]]),
  );
  const setHours = (hours: number) => {
    const next = timeRange(hours);
    setRange(next);
    setDraft(next);
    setRangeError(false);
  };
  const savePreference = (reset = false) => {
    try {
      if (reset) localStorage.removeItem(storageKey);
      else localStorage.setItem(storageKey, JSON.stringify(metricDraft));
      setChosen({ key: storageKey, ids: reset ? null : metricDraft });
      setPreferenceError(""); setPickerOpen(false);
    } catch { setPreferenceError("浏览器未能保存，请检查存储权限后重试。"); }
  };
  const imageDevice = node?.target.kind === "device" ? node.target.device_id : device.device_id;
  return { tab, setTab, mediaAvailable, setMediaAvailable, nodeKey, setNodeKey, chosen, setChosen,
    pickerOpen, setPickerOpen, metricDraft, setMetricDraft, preferenceError, setPreferenceError,
    focusedChart, setFocusedChart, storageKey, range, setRange, draft, setDraft, rangeError, setRangeError,
    streams, isGateway, nodes, catalog, node, metrics, selected, visible, chartIds, results, setHours,
    savePreference, imageDevice };
}
