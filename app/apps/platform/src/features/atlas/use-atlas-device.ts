import { useAuth } from "@thcpn/auth";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useQueries, useQuery } from "@tanstack/react-query";
import { api, type DeviceMapItem } from "@thcpn/api";
import { workspaceQueryKey } from "@thcpn/workspace";
import { policyLimit } from "../../shared/config/system-policy";
import {
  ATLAS_METRIC_LIMIT,
  defaultMetricIds,
  preferenceKey,
  readMetricPreference,
} from "./atlas-metric-preferences";
import { streamCatalog, timeRange, type AtlasConfig } from "./atlas-model";

export type AtlasDeviceOptions = {
  device: DeviceMapItem;
  workspaceId: string;
  config: AtlasConfig;
  boardId?: string;
  selectedNodeKey?: string;
  onNodeChange?: (key: string) => void;
  hours?: number;
  onHoursChange?: (hours: number) => void;
};

const MAX_COMPARE_OVERLAYS = 2;

export function useAtlasDevice({
  device,
  workspaceId,
  config,
  boardId = "default",
  selectedNodeKey,
  hours: controlledHours,
  onHoursChange,
}: AtlasDeviceOptions) {
  const { user } = useAuth();
  const [tab, setTab] = useState("images");
  const [mediaAvailable, setMediaAvailable] = useState(true);
  const [nodeKey, setNodeKey] = useState(selectedNodeKey ?? "gateway");
  const [chosen, setChosen] = useState<{ key: string; ids: string[] | null } | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [metricDraft, setMetricDraft] = useState<string[]>([]);
  const [preferenceError, setPreferenceError] = useState("");
  const [focusedChart, setFocusedChart] = useState<string | null>(null);
  const [compareIds, setCompareIds] = useState<string[]>([]);

  useEffect(() => {
    if (selectedNodeKey !== undefined) setNodeKey(selectedNodeKey);
  }, [selectedNodeKey]);

  const storageKey = preferenceKey(
    user?.id ?? "anonymous",
    workspaceId,
    boardId,
    device.device_id,
    nodeKey,
  );
  const savedPreference = useMemo(() => readMetricPreference(storageKey), [storageKey]);

  useEffect(() => {
    setPickerOpen(false);
    setPreferenceError("");
    setMediaAvailable(true);
    setCompareIds([]);
  }, [storageKey]);

  const initialHours = controlledHours ?? config.trend_hours ?? 24;
  const [localHours, setLocalHours] = useState(initialHours);
  const activeHours = controlledHours ?? localHours;
  const [range, setRange] = useState(() => timeRange(activeHours));
  const [draft, setDraft] = useState(range);
  const [rangeError, setRangeError] = useState(false);

  useEffect(() => {
    if (controlledHours !== undefined && controlledHours !== localHours) {
      setLocalHours(controlledHours);
      const next = timeRange(controlledHours);
      setRange(next);
      setDraft(next);
      setRangeError(false);
    }
  }, [controlledHours, localHours]);

  const streams = useQuery({
    queryKey: workspaceQueryKey(workspaceId, "atlas", device.device_id, "streams"),
    queryFn: () => api.dataStreams.list(device.device_id),
    staleTime: 60000,
  });

  const isGateway = device.device_type === "gateway";
  const nodes = useQuery({
    queryKey: workspaceQueryKey(workspaceId, "atlas", device.device_id, "nodes"),
    queryFn: () => api.devices.nodes(device.device_id),
    enabled: isGateway,
    staleTime: 60000,
  });

  const catalog = useMemo(
    () => streamCatalog(streams.data?.items ?? [], nodes.data?.items ?? []),
    [streams.data, nodes.data],
  );
  const node = nodes.data?.items.find((n) => n.key === nodeKey);
  const metrics = useMemo(
    () =>
      catalog.filter(
        (s) =>
          s.type === "telemetry" &&
          (node ? node.streams.some((n) => n.id === s.id) : isGateway && nodeKey !== "gateway" ? false : !s.node),
      ),
    [catalog, node, isGateway, nodeKey],
  );

  const defaults = useMemo(
    () =>
      defaultMetricIds(
        metrics,
        config.metric_defaults?.[`device:${device.device_type}`],
        config.telemetry_stream_ids,
      ),
    [metrics, config.metric_defaults, device.device_type, config.telemetry_stream_ids],
  );

  const selected = useMemo(
    () =>
      (chosen?.key === storageKey ? chosen.ids ?? defaults : savedPreference ?? defaults).filter(
        (id) => metrics.some((stream) => stream.id === id),
      ),
    [chosen, storageKey, defaults, savedPreference, metrics],
  );

  const visible = useMemo(
    () => selected.flatMap((id) => metrics.filter((stream) => stream.id === id)),
    [selected, metrics],
  );

  const chartIds =
    config.show_trends === false
      ? []
      : [
          ...new Set([
            ...(focusedChart && metrics.some((s) => s.id === focusedChart) ? [focusedChart] : []),
            ...compareIds.filter((id) => metrics.some((s) => s.id === id)),
            ...selected,
          ]),
        ].slice(0, 3);

  // Query all active telemetry metrics so both compact sparklines and instant trend switching work seamlessly.
  const queryStreams = metrics;

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
          targetPoints: Math.min(300, policyLimit("query_points", 5000)),
          limit: Math.min(5000, policyLimit("query_points", 5000)),
        }),
      staleTime: 60000,
      retry: false,
    })),
  });

  const results = new Map(queryStreams.map((stream, index) => [stream.id, queries[index]]));

  const setHours = useCallback(
    (hours: number) => {
      setLocalHours(hours);
      const next = timeRange(hours);
      setRange(next);
      setDraft(next);
      setRangeError(false);
      onHoursChange?.(hours);
    },
    [onHoursChange],
  );

  const savePreference = (reset = false) => {
    try {
      if (reset) localStorage.removeItem(storageKey);
      else localStorage.setItem(storageKey, JSON.stringify(metricDraft));
      setChosen({ key: storageKey, ids: reset ? null : metricDraft });
      setPreferenceError("");
      setPickerOpen(false);
    } catch {
      setPreferenceError("浏览器未能保存，请检查存储权限后重试。");
    }
  };

  const togglePin = useCallback(
    (streamId: string): boolean => {
      const exists = selected.includes(streamId);
      if (!exists && selected.length >= ATLAS_METRIC_LIMIT) return false;
      const next = exists
        ? selected.filter((id) => id !== streamId)
        : [...selected, streamId].slice(0, ATLAS_METRIC_LIMIT);
      try {
        localStorage.setItem(storageKey, JSON.stringify(next));
      } catch {
        // Keep in-memory state even if storage is unavailable.
      }
      setChosen({ key: storageKey, ids: next });
      return true;
    },
    [selected, storageKey],
  );

  const toggleCompare = useCallback(
    (streamId: string) => {
      setCompareIds((current) => {
        if (current.includes(streamId)) return current.filter((id) => id !== streamId);
        if (current.length >= MAX_COMPARE_OVERLAYS) return [...current.slice(1), streamId];
        return [...current, streamId];
      });
    },
    [],
  );

  const imageDevice = node?.target.kind === "device" ? node.target.device_id : device.device_id;

  return {
    tab,
    setTab,
    mediaAvailable,
    setMediaAvailable,
    nodeKey,
    setNodeKey,
    chosen,
    setChosen,
    pickerOpen,
    setPickerOpen,
    metricDraft,
    setMetricDraft,
    preferenceError,
    setPreferenceError,
    focusedChart,
    setFocusedChart,
    compareIds,
    setCompareIds,
    toggleCompare,
    storageKey,
    hours: activeHours,
    range,
    setRange,
    draft,
    setDraft,
    rangeError,
    setRangeError,
    streams,
    isGateway,
    nodes,
    catalog,
    node,
    metrics,
    selected,
    visible,
    chartIds,
    results,
    setHours,
    savePreference,
    togglePin,
    imageDevice,
  };
}
