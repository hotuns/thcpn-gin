import { useMemo, useState } from "react";
import { useQueries, useQuery } from "@tanstack/react-query";
import { Check, ChevronsUpDown } from "lucide-react";
import { api, type Device } from "@thcpn/api";
import { useWorkspace, workspaceQueryKey } from "@thcpn/workspace";
import { Button } from "./components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "./components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "./components/ui/popover";
import { Tabs, TabsList, TabsTrigger } from "./components/ui/tabs";

export type DeviceOptionCategory = "all" | "gateway" | "gateway_node" | "camera" | "carbon_sink" | "standalone";

const categories: Array<{ id: DeviceOptionCategory; label: string }> = [
  { id: "all", label: "全部" },
  { id: "standalone", label: "标准站" },
  { id: "gateway", label: "组网站" },
  { id: "carbon_sink", label: "碳汇站" },
  { id: "camera", label: "监控站" },
];

const categoryOrder = categories.slice(1).map((item) => item.id);

export const deviceOptionCategory = (device: Device): Exclude<DeviceOptionCategory, "all"> => {
  if (device.device_type === "carbon_sink") return "carbon_sink";
  const value = device.topology_role || device.device_type;
  return value === "gateway" || value === "gateway_node" || value === "camera"
    ? value
    : "standalone";
};

export function filterDeviceOptions(
  devices: Device[],
  keyword: string,
  category: DeviceOptionCategory = "all",
  tagsByDevice: Map<string, string[]> = new Map(),
) {
  const normalized = keyword.trim().toLowerCase();
  return devices.filter((device) => {
    const categoryMatches = category === "all" || deviceOptionCategory(device) === category;
    const keywordMatches = !normalized || [device.name, device.serial_no, device.id, ...(tagsByDevice.get(device.id) ?? [])]
      .filter(Boolean)
      .some((item) => item.toLowerCase().includes(normalized));
    return categoryMatches && keywordMatches;
  });
}

export function DeviceCombobox({
  devices,
  value,
  onChange,
  ariaLabel = "搜索并选择设备",
  placeholder = "搜索设备名称、序列号或 ID",
  className = "",
}: {
  devices: Device[];
  value: string;
  onChange: (deviceId: string) => void;
  ariaLabel?: string;
  placeholder?: string;
  className?: string;
}) {
  const { currentId } = useWorkspace();
  const [open, setOpen] = useState(false);
  const [keyword, setKeyword] = useState("");
  const [category, setCategory] = useState<DeviceOptionCategory>("all");
  const mapQuery = useQuery({
    queryKey: workspaceQueryKey(currentId, "device-map", "true"),
    queryFn: () => api.devices.map(currentId!, true),
    enabled: Boolean(currentId && open),
  });
  const tagsByDevice = useMemo(
    () => new Map((mapQuery.data?.items ?? []).map((item) => [item.device_id, item.environment.research_tags])),
    [mapQuery.data?.items],
  );
  const gateways = useMemo(
    () => devices.filter((item) => deviceOptionCategory(item) === "gateway"),
    [devices],
  );
  const childQueries = useQueries({
    queries: gateways.map((gateway) => ({
      queryKey: ["device-combobox", gateway.id, "children"],
      queryFn: () => api.devices.children(gateway.id),
      enabled: open,
      staleTime: 60_000,
    })),
  });
  const childrenByGateway = useMemo(
    () => new Map(gateways.map((gateway, index) => [
      gateway.id,
      (childQueries[index]?.data?.items ?? []).map((item) => item.device),
    ])),
    [childQueries, gateways],
  );
  const childDevices = useMemo(
    () => Array.from(childrenByGateway.values()).flat(),
    [childrenByGateway],
  );
  const selected = [...devices, ...childDevices].find((item) => item.id === value);
  const matches = useMemo(
    () => filterDeviceOptions(
      devices.filter((item) => deviceOptionCategory(item) !== "gateway_node"),
      keyword,
      category,
      tagsByDevice,
    ).slice(0, 100),
    [category, devices, keyword, tagsByDevice],
  );

  const selectDevice = (deviceId: string) => {
    onChange(deviceId);
    setKeyword("");
    setOpen(false);
  };
  const grouped = categoryOrder
    .filter((id) => id !== "gateway")
    .map((id) => ({
      id,
      label: categories.find((item) => item.id === id)!.label,
      items: matches.filter((item) => deviceOptionCategory(item) === id),
    }))
    .filter((group) => group.items.length);
  const normalizedKeyword = keyword.trim().toLowerCase();
  const gatewayGroups = gateways.map((gateway) => {
    const children = childrenByGateway.get(gateway.id) ?? [];
    const gatewayMatches = !normalizedKeyword || [gateway.name, gateway.serial_no, gateway.id, ...(tagsByDevice.get(gateway.id) ?? [])]
      .filter(Boolean)
      .some((item) => item.toLowerCase().includes(normalizedKeyword));
    const matchingChildren = children.filter((child) =>
      !normalizedKeyword || [child.name, child.serial_no, child.id, ...(tagsByDevice.get(child.id) ?? [])]
        .filter(Boolean)
        .some((item) => item.toLowerCase().includes(normalizedKeyword)),
    );
    return {
      gateway,
      children: gatewayMatches ? children : matchingChildren,
      visible: gatewayMatches || matchingChildren.length > 0,
    };
  }).filter((group) => group.visible && (category === "all" || category === "gateway"));
  const hasResults = grouped.length > 0 || gatewayGroups.length > 0;

  return (
    <Popover
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        if (nextOpen) {
          setKeyword("");
          setCategory("all");
        }
      }}
    >
      <div className={`device-quick-switch-control ${className}`.trim()}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            className="device-quick-switch-input"
            role="combobox"
            aria-label={ariaLabel}
            aria-expanded={open}
          >
            <span className={`device-quick-switch-value${selected ? "" : " placeholder"}`}>
              {selected?.name ?? placeholder}
            </span>
            <ChevronsUpDown size={14} aria-hidden="true" />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          className="device-quick-switch-menu"
          align="end"
          onOpenAutoFocus={(event) => event.preventDefault()}
        >
          <Command shouldFilter={false} loop>
            <CommandInput
              autoFocus
              value={keyword}
              onValueChange={setKeyword}
              placeholder={placeholder}
              aria-label={ariaLabel}
            />
            <Tabs
              value={category}
              onValueChange={(nextCategory) => setCategory(nextCategory as DeviceOptionCategory)}
            >
              <TabsList className="device-option-categories" aria-label="设备分类">
                {categories.map((item) => (
                  <TabsTrigger key={item.id} value={item.id}>
                    {item.label}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
            <CommandList className="device-option-results">
              {!hasResults && <CommandEmpty>没有匹配的设备</CommandEmpty>}
              {gatewayGroups.length > 0 && (
                <CommandGroup heading={`网关 · ${gatewayGroups.length}`} className="device-option-group device-option-gateway-group">
                  {gatewayGroups.map(({ gateway, children }) => (
                    <div key={gateway.id} className="device-option-gateway">
                      <DeviceCommandItem
                        device={gateway}
                        selected={gateway.id === value}
                        detail={`SN ${gateway.serial_no} · ${children.length} 个节点`}
                        onSelect={selectDevice}
                      />
                      {children.map((child) => (
                        <DeviceCommandItem
                          key={child.id}
                          device={child}
                          selected={child.id === value}
                          detail={`SN ${child.serial_no}`}
                          child
                          onSelect={selectDevice}
                        />
                      ))}
                    </div>
                  ))}
                </CommandGroup>
              )}
              {grouped.map((group) => (
                <CommandGroup key={group.id} heading={`${group.label} · ${group.items.length}`} className="device-option-group">
                  {group.items.map((item) => (
                    <DeviceCommandItem
                      key={item.id}
                      device={item}
                      selected={item.id === value}
                      detail={`SN ${item.serial_no}`}
                      onSelect={selectDevice}
                    />
                  ))}
                </CommandGroup>
              ))}
            </CommandList>
          </Command>
        </PopoverContent>
      </div>
    </Popover>
  );
}

function DeviceCommandItem({
  device,
  selected,
  detail,
  child = false,
  onSelect,
}: {
  device: Device;
  selected: boolean;
  detail: string;
  child?: boolean;
  onSelect: (deviceId: string) => void;
}) {
  return (
    <CommandItem
      value={device.id}
      className={`device-option-item${child ? " device-option-child" : ""}${selected ? " selected" : ""}`}
      onSelect={() => onSelect(device.id)}
    >
      <span>
        <strong>{device.name}</strong>
        <small>{detail}</small>
      </span>
      <Check className="device-option-check" size={14} aria-hidden="true" />
    </CommandItem>
  );
}
