import { useEffect, useId, useMemo, useRef, useState } from "react";
import { ChevronDown, Search } from "lucide-react";
import type { Device } from "@thcpn/api";

export type DeviceOptionCategory = "all" | "gateway" | "gateway_node" | "camera" | "standalone";

const categories: Array<{ id: DeviceOptionCategory; label: string }> = [
  { id: "all", label: "全部" },
  { id: "gateway", label: "组网站" },
  { id: "gateway_node", label: "节点" },
  { id: "camera", label: "相机" },
  { id: "standalone", label: "标准站" },
];

const categoryOrder = categories.slice(1).map((item) => item.id);

export const deviceOptionCategory = (device: Device): Exclude<DeviceOptionCategory, "all"> => {
  const value = device.topology_role || device.device_type;
  return value === "gateway" || value === "gateway_node" || value === "camera"
    ? value
    : "standalone";
};

export function filterDeviceOptions(
  devices: Device[],
  keyword: string,
  category: DeviceOptionCategory = "all",
) {
  const normalized = keyword.trim().toLowerCase();
  return devices.filter((device) => {
    const categoryMatches = category === "all" || deviceOptionCategory(device) === category;
    const keywordMatches = !normalized || [device.name, device.serial_no, device.id]
      .filter(Boolean)
      .some((value) => value.toLowerCase().includes(normalized));
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
  const rootRef = useRef<HTMLDivElement>(null);
  const listboxId = useId();
  const [open, setOpen] = useState(false);
  const [keyword, setKeyword] = useState("");
  const [category, setCategory] = useState<DeviceOptionCategory>("all");
  const selected = devices.find((item) => item.id === value);
  const matches = useMemo(
    () => filterDeviceOptions(devices, keyword, category).slice(0, 100),
    [category, devices, keyword],
  );

  useEffect(() => {
    if (!open) return;
    const outside = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", outside);
    window.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("mousedown", outside);
      window.removeEventListener("keydown", escape);
    };
  }, [open]);

  const openMenu = () => {
    setKeyword("");
    setCategory("all");
    setOpen(true);
  };
  const selectDevice = (deviceId: string) => {
    onChange(deviceId);
    setKeyword("");
    setOpen(false);
  };
  const grouped = categoryOrder
    .map((id) => ({
      id,
      label: categories.find((item) => item.id === id)!.label,
      items: matches.filter((item) => deviceOptionCategory(item) === id),
    }))
    .filter((group) => group.items.length);

  return (
    <div className={`device-quick-switch-control ${className}`.trim()} ref={rootRef}>
      <div className="device-quick-switch-input">
        <Search size={14} aria-hidden="true" />
        <input
          role="combobox"
          aria-label={ariaLabel}
          aria-expanded={open}
          aria-controls={listboxId}
          autoComplete="off"
          value={open ? keyword : selected ? selected.name : ""}
          placeholder={placeholder}
          onFocus={openMenu}
          onChange={(event) => {
            setKeyword(event.target.value);
            setOpen(true);
          }}
        />
        <ChevronDown size={14} aria-hidden="true" className={`device-quick-switch-chevron ${open ? "open" : ""}`} />
      </div>
      {open && (
        <div id={listboxId} className="device-quick-switch-menu" role="listbox">
          <div className="device-option-categories" role="group" aria-label="设备分类">
            {categories.map((item) => (
              <button
                key={item.id}
                type="button"
                className={category === item.id ? "active" : ""}
                onClick={() => setCategory(item.id)}
              >
                {item.label}
              </button>
            ))}
          </div>
          <div className="device-option-results">
            {grouped.length ? grouped.map((group) => (
              <section key={group.id} className="device-option-group">
                <div className="device-option-group-title">
                  <span>{group.label}</span><small>{group.items.length}</small>
                </div>
                {group.items.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    role="option"
                    aria-selected={item.id === value}
                    className={item.id === value ? "selected" : undefined}
                    onClick={() => selectDevice(item.id)}
                  >
                    <strong>{item.name}</strong>
                    <small>{item.serial_no || item.id}</small>
                  </button>
                ))}
              </section>
            )) : <div className="device-quick-switch-empty">没有匹配的设备</div>}
          </div>
        </div>
      )}
    </div>
  );
}
