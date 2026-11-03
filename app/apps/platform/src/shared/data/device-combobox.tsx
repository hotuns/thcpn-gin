import "./data-selectors-mobile.css";
import { useEffect, useMemo, useState } from "react";
import { useQueries } from "@tanstack/react-query";
import { Check, ChevronsUpDown } from "lucide-react";
import { api, type Device } from "@thcpn/api";
import { useWorkspace, workspaceQueryKey } from "@thcpn/workspace";
import { useIsMobile } from "../hooks/use-mobile";
import { Button } from "../ui/primitives/button";
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from "../ui/primitives/dialog";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "../ui/primitives/command";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/primitives/popover";
import { Tabs, TabsList, TabsTrigger } from "../ui/primitives/tabs";

export type DeviceOption = Pick<Device, "id" | "name" | "serial_no" | "device_type"> &
  Partial<Pick<Device, "topology_role" | "tags">> & { research_tags?: string[] };
export type DeviceOptionCategory = "all" | "gateway" | "gateway_node" | "camera" | "carbon_sink" | "standalone";

const categories: Array<{ id: DeviceOptionCategory; label: string }> = [
  { id: "all", label: "全部" },
  { id: "standalone", label: "标准站" },
  { id: "gateway", label: "组网站" },
  { id: "gateway_node", label: "节点" },
  { id: "carbon_sink", label: "碳汇站" },
  { id: "camera", label: "视频站" },
];

export const deviceOptionCategory = (device: DeviceOption): Exclude<DeviceOptionCategory, "all"> => {
  if (device.device_type === "carbon_sink") return "carbon_sink";
  const value = device.topology_role || device.device_type;
  return value === "gateway" || value === "gateway_node" || value === "camera" ? value : "standalone";
};

export function filterDeviceOptions(
  devices: DeviceOption[],
  keyword: string,
  category: DeviceOptionCategory = "all",
  tagsByDevice: Map<string, string[]> = new Map(),
) {
  const normalized = keyword.trim().toLowerCase();
  return devices.filter((device) =>
    (category === "all" || deviceOptionCategory(device) === category) &&
    (!normalized || [device.name, device.serial_no, device.id, ...(device.tags ?? []), ...(device.research_tags ?? []), ...(tagsByDevice.get(device.id) ?? [])]
      .some((item) => item.toLowerCase().includes(normalized))),
  );
}

type DeviceComboboxProps = {
  devices: DeviceOption[];
  ariaLabel?: string;
  placeholder?: string;
  searchPlaceholder?: string;
  className?: string;
  variant?: "compact" | "field" | "inline";
  // Only expand gateways when the business permits selecting their children.
  includeNodes?: boolean;
  disabled?: boolean;
  loading?: boolean;
} & ({
  multiple?: false;
  value: string;
  onChange: (deviceId: string) => void;
} | {
  multiple: true;
  value: string[];
  onChange: (deviceIds: string[]) => void;
  maxSelected?: number;
});

export function DeviceCombobox(props: DeviceComboboxProps) {
  const {
    devices, ariaLabel = "选择设备", placeholder = "请选择设备",
    searchPlaceholder = "搜索名称、序列号、ID 或标签", className = "",
    variant = "field", includeNodes = false, disabled = false, loading = false,
  } = props;
  const { currentId } = useWorkspace();
  const isMobile = useIsMobile();
  const [open, setOpen] = useState(false);
  const [keyword, setKeyword] = useState("");
  const [category, setCategory] = useState<DeviceOptionCategory>("all");
  useEffect(() => { setOpen(false); setKeyword(""); setCategory("all"); }, [currentId]);
  const gateways = useMemo(() => devices.filter((item) => deviceOptionCategory(item) === "gateway"), [devices]);
  const selectedIds = props.multiple ? props.value : props.value ? [props.value] : [];
  const selectedNeedsChildren = selectedIds.some((id) => !devices.some((device) => device.id === id));
  const childQueries = useQueries({
    queries: (includeNodes ? gateways : []).map((gateway) => ({
      queryKey: workspaceQueryKey(currentId, "device-options", gateway.id, "children"),
      queryFn: () => api.devices.children(gateway.id),
      enabled: !disabled && (open || variant === "inline" || selectedNeedsChildren),
      staleTime: 60_000,
    })),
  });
  const childrenByGateway = new Map(gateways.map((gateway, index) => [
    gateway.id,
    includeNodes ? (childQueries[index]?.data?.items ?? []).map((item) => item.device) : [],
  ]));
  const options = Array.from(new Map([
    ...Array.from(childrenByGateway.values()).flat(), ...devices,
  ].map((item) => [item.id, item])).values());
  const selectedSet = new Set(selectedIds);
  const maxSelected = props.multiple ? props.maxSelected ?? Infinity : 1;
  const atLimit = selectedIds.length >= maxSelected;
  const selected = options.filter((item) => selectedSet.has(item.id));
  const matches = filterDeviceOptions(options, keyword, category);
  const matchingIds = new Set(matches.map((item) => item.id));
  const gatewayGroups = gateways.map((gateway) => {
    const children = childrenByGateway.get(gateway.id) ?? [];
    const gatewayMatches = filterDeviceOptions([gateway], keyword).length > 0;
    return {
      gateway,
      children: gatewayMatches ? children : children.filter((child) => matchingIds.has(child.id)),
      visible: gatewayMatches || children.some((child) => matchingIds.has(child.id)),
    };
  }).filter((group) => group.visible && (category === "all" || category === "gateway"));
  const nestedIds = new Set(gatewayGroups.flatMap((group) => group.children.map((item) => item.id)));
  const grouped = categories.filter((item) => item.id !== "all" && item.id !== "gateway").map((item) => ({
    ...item,
    items: matches.filter((device) => deviceOptionCategory(device) === item.id && !nestedIds.has(device.id)),
  })).filter((group) => group.items.length > 0);
  const visibleIds = Array.from(new Set([
    ...gatewayGroups.flatMap(({ gateway, children }) => [gateway.id, ...children.map((item) => item.id)]),
    ...grouped.flatMap((group) => group.items.map((item) => item.id)),
  ]));
  const availableCategories = categories.filter((item) => item.id === "all" || options.some((device) => deviceOptionCategory(device) === item.id));
  const busy = loading || childQueries.some((query) => query.isFetching);
  const childError = childQueries.some((query) => query.isError);
  const changeOpen = (nextOpen: boolean) => {
    setOpen(nextOpen);
    if (nextOpen) { setKeyword(""); setCategory("all"); }
  };
  const selectDevice = (id: string) => {
    if (disabled) return;
    if (props.multiple) {
      if (selectedSet.has(id)) props.onChange(selectedIds.filter((item) => item !== id));
      else if (!atLimit) props.onChange([...selectedIds, id]);
    } else {
      props.onChange(id);
      setKeyword("");
      setOpen(false);
    }
  };
  const renderDevice = (device: DeviceOption, child = false) => (
    <CommandItem
      key={device.id}
      value={device.id}
      disabled={disabled || (!selectedSet.has(device.id) && props.multiple && atLimit)}
      aria-label={`${device.name}${selectedSet.has(device.id) ? "，已选择" : ""}`}
      className={`device-option-item${child ? " device-option-child" : ""}${selectedSet.has(device.id) ? " selected" : ""}`}
      onSelect={() => selectDevice(device.id)}
    >
      <span><strong>{device.name}</strong><small>{device.serial_no ? `SN ${device.serial_no}` : `ID ${device.id}`}</small></span>
      <Check className="device-option-check" size={16} aria-hidden="true" />
    </CommandItem>
  );
  const summary = props.multiple
    ? selectedIds.length ? `${selected[0]?.name ?? "已选设备"}${selectedIds.length > 1 ? ` 等 ${selectedIds.length} 台` : ""}` : placeholder
    : selected[0]?.name ?? (props.value ? "已选设备（不在当前可选范围）" : placeholder);
  const content = (
    <Command shouldFilter={false} loop label={ariaLabel} className="device-selector-command" defaultValue={variant === "inline" ? "__device_selector_idle__" : undefined}>
      <CommandInput
        autoFocus={variant !== "inline"}
        value={keyword}
        onValueChange={setKeyword}
        disabled={disabled}
        placeholder={searchPlaceholder}
        aria-label={`${ariaLabel}：搜索`}
      />
      {availableCategories.length > 2 && <Tabs value={category} onValueChange={(value) => setCategory(value as DeviceOptionCategory)} onKeyDown={(event) => event.stopPropagation()}>
        <TabsList className="device-option-categories" aria-label="设备分类">
          {availableCategories.map((item) => <TabsTrigger key={item.id} value={item.id} disabled={disabled}>{item.label}</TabsTrigger>)}
        </TabsList>
      </Tabs>}
      {props.multiple && <div className="device-selector-toolbar" onKeyDown={(event) => event.stopPropagation()}>
        <span aria-live="polite">已选 {selectedIds.length} 台{Number.isFinite(maxSelected) ? ` / 最多 ${maxSelected} 台` : ""}</span>
        <div>
          <Button type="button" variant="ghost" size="sm" disabled={disabled || atLimit || !visibleIds.some((id) => !selectedSet.has(id))} onClick={() => props.onChange([...selectedIds, ...visibleIds.filter((id) => !selectedSet.has(id)).slice(0, Math.max(0, maxSelected - selectedIds.length))])}>全选筛选结果</Button>
          <Button type="button" variant="ghost" size="sm" disabled={disabled || !selectedIds.length} onClick={() => props.onChange([])}>清空</Button>
        </div>
      </div>}
      {busy && <p className="device-selector-status" role="status">正在加载{loading ? "设备" : "节点"}…</p>}
      {childError && <div className="device-selector-status" role="alert">部分节点加载失败<Button type="button" variant="ghost" size="sm" onClick={() => childQueries.filter((query) => query.isError).forEach((query) => void query.refetch())}>重试</Button></div>}
      <CommandList className="device-option-results" aria-label={ariaLabel}>
        {!visibleIds.length && !busy && <CommandEmpty>{options.length ? "没有匹配的设备，请调整搜索或分类" : "暂无可选设备"}</CommandEmpty>}
        {gatewayGroups.length > 0 && <CommandGroup heading={`组网站 · ${gatewayGroups.length}`} className="device-option-group device-option-gateway-group">
          {gatewayGroups.map(({ gateway, children }) => <div key={gateway.id} className="device-option-gateway">{renderDevice(gateway)}{children.map((child) => renderDevice(child, true))}</div>)}
        </CommandGroup>}
        {grouped.map((group) => <CommandGroup key={group.id} heading={`${group.label} · ${group.items.length}`} className="device-option-group">{group.items.map((device) => renderDevice(device))}</CommandGroup>)}
      </CommandList>
      {props.multiple && variant !== "inline" && <div className="device-selector-footer" onKeyDown={(event) => event.stopPropagation()}><Button type="button" onClick={() => setOpen(false)}>完成</Button></div>}
    </Command>
  );
  const trigger = (
    <Button type="button" variant="outline" className="device-quick-switch-input" role="combobox" aria-haspopup={isMobile ? "dialog" : "listbox"} aria-label={ariaLabel} aria-expanded={open} disabled={disabled} title={summary}>
      <span className={`device-quick-switch-value${selectedIds.length ? "" : " placeholder"}`}>{loading && !selectedIds.length ? "正在加载设备…" : summary}</span>
      <ChevronsUpDown size={14} aria-hidden="true" />
    </Button>
  );
  return <div className={`device-quick-switch-control device-selector-${variant} ${className}`.trim()}>
    {variant === "inline" ? content : isMobile ? <Dialog open={open} onOpenChange={changeOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="data-device-selector" aria-describedby={undefined}>
        <DialogTitle>{ariaLabel}</DialogTitle>
        {content}
      </DialogContent>
    </Dialog> : <Popover open={open} onOpenChange={changeOpen}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent className="device-quick-switch-menu" align={variant === "compact" ? "end" : "start"}>{content}</PopoverContent>
    </Popover>}
  </div>;
}
