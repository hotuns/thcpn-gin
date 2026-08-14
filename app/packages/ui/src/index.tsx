import {
  useMemo,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type CSSProperties,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
} from "react";
import {
  AlertTriangle,
  CalendarDays,
  Check,
  ChevronDown,
  Copy,
  Database,
  FileWarning,
  Inbox,
  Menu,
  RefreshCw,
  Search,
  Server,
  ShieldAlert,
  X,
} from "lucide-react";
import { cn } from "./utils";
import { useLocale } from "@thcpn/i18n";

export { cn } from "./utils";

export function Button({
  variant = "primary",
  className,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "danger";
}) {
  return (
    <button className={cn("btn", `btn-${variant}`, className)} {...props}>
      {children}
    </button>
  );
}

export function IconButton({
  label,
  children,
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button
      aria-label={label}
      title={label}
      className={cn("icon-btn", className)}
      {...props}
    >
      {children}
    </button>
  );
}

export function Badge({
  tone = "neutral",
  children,
}: {
  tone?: "success" | "info" | "warning" | "danger" | "neutral";
  children: ReactNode;
}) {
  return <span className={`badge ${tone}`}>{children}</span>;
}

export const Tag = Badge;

export function TextInput({
  leading,
  className,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { leading?: ReactNode }) {
  return (
    <span className={cn("ui-input", className)}>
      {leading && <span className="ui-control-leading">{leading}</span>}
      <input {...props} />
    </span>
  );
}

export function SearchInput(
  props: Omit<InputHTMLAttributes<HTMLInputElement>, "type">,
) {
  return <TextInput {...props} type="search" leading={<Search size={16} />} />;
}

export function SelectInput({
  leading,
  className,
  children,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement> & { leading?: ReactNode }) {
  return (
    <span className={cn("ui-select", className)}>
      {leading && <span className="ui-control-leading">{leading}</span>}
      <select {...props}>{children}</select>
      <ChevronDown className="ui-control-chevron" size={15} />
    </span>
  );
}

export function DateTimeInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <label className="ui-datetime-field">
      <span>{label}</span>
      <span className="ui-datetime">
        <CalendarDays size={16} />
        <input
          ref={inputRef}
          type="datetime-local"
          required
          value={value}
          onChange={(event) => onChange(event.target.value)}
        />
        <button
          type="button"
          aria-label={`选择${label}`}
          onClick={() => inputRef.current?.showPicker?.()}
        >
          <ChevronDown size={14} />
        </button>
      </span>
    </label>
  );
}

export function ChoiceCard({
  checked,
  onChange,
  title,
  description,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  title: string;
  description?: string;
}) {
  return (
    <label className={cn("ui-choice-card", checked && "is-checked")}>
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span className="ui-check-mark">{checked && <Check size={13} />}</span>
      <span>
        <strong>{title}</strong>
        {description && <small>{description}</small>}
      </span>
    </label>
  );
}

export type PickerOption = { id: string; label: string; description?: string };

export function EntityPicker({
  label,
  icon,
  options,
  selectedIds,
  onChange,
  mode = "single",
  placeholder,
  searchPlaceholder,
}: {
  label: string;
  icon: ReactNode;
  options: PickerOption[];
  selectedIds: string[];
  onChange: (ids: string[]) => void;
  mode?: "single" | "multiple";
  placeholder: string;
  searchPlaceholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [keyword, setKeyword] = useState("");
  const selected = options.filter((item) => selectedIds.includes(item.id));
  const filtered = useMemo(
    () =>
      options.filter((item) =>
        `${item.label} ${item.description ?? ""}`
          .toLowerCase()
          .includes(keyword.toLowerCase()),
      ),
    [options, keyword],
  );
  const choose = (id: string) => {
    if (mode === "single") {
      onChange([id]);
      setOpen(false);
      setKeyword("");
      return;
    }
    onChange(
      selectedIds.includes(id)
        ? selectedIds.filter((item) => item !== id)
        : [...selectedIds, id],
    );
  };
  return (
    <section className="ui-picker" data-mode={mode}>
      <span className="ui-picker-label">{label}</span>
      <button
        type="button"
        className={cn("ui-picker-trigger", open && "is-open")}
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <span className="ui-picker-icon">{icon}</span>
        <span>
          <strong>
            {selected.length
              ? mode === "multiple"
                ? `已选择 ${selected.length} 项`
                : selected[0].label
              : placeholder}
          </strong>
          <small>
            {selected.length
              ? mode === "multiple"
                ? selected.map((item) => item.label).join("、")
                : selected[0].description || "已选择"
              : `共 ${options.length} 个可选项`}
          </small>
        </span>
        {mode === "multiple" && selected.length > 0 && (
          <em>{selected.length}</em>
        )}
        <ChevronDown size={16} />
      </button>
      {open && (
        <div className="ui-picker-menu">
          <SearchInput
            autoFocus
            placeholder={searchPlaceholder ?? `搜索${label}`}
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
          />
          {mode === "multiple" && (
            <div className="ui-picker-actions">
              <span>当前筛选 {filtered.length} 项</span>
              <span>
                <button
                  type="button"
                  onClick={() =>
                    onChange(
                      Array.from(
                        new Set([
                          ...selectedIds,
                          ...filtered.map((item) => item.id),
                        ]),
                      ),
                    )
                  }
                >
                  全选
                </button>
                <button
                  type="button"
                  onClick={() =>
                    onChange(
                      selectedIds.filter(
                        (id) => !filtered.some((item) => item.id === id),
                      ),
                    )
                  }
                >
                  清除
                </button>
              </span>
            </div>
          )}
          <div className="ui-picker-options">
            {filtered.map((item) => {
              const checked = selectedIds.includes(item.id);
              return (
                <button
                  type="button"
                  key={item.id}
                  className={checked ? "is-selected" : ""}
                  onClick={() => choose(item.id)}
                >
                  <span className="ui-check-mark">
                    {checked && <Check size={13} />}
                  </span>
                  <span>
                    <strong>{item.label}</strong>
                    {item.description && <small>{item.description}</small>}
                  </span>
                </button>
              );
            })}
            {filtered.length === 0 && <p>没有匹配的选项</p>}
          </div>
          {mode === "multiple" && (
            <div className="ui-picker-footer">
              <span>已选择 {selected.length} 项</span>
              <button type="button" onClick={() => setOpen(false)}>
                完成
              </button>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

export function Panel({
  className,
  style,
  children,
}: {
  className?: string;
  style?: CSSProperties;
  children: ReactNode;
}) {
  return (
    <section className={cn("panel", className)} style={style}>
      {children}
    </section>
  );
}

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="page-header">
      <div>
        <div className="eyebrow">{eyebrow}</div>
        <h1 className="page-title">{title}</h1>
        {description && <p className="page-description">{description}</p>}
      </div>
      {actions && <div className="header-actions">{actions}</div>}
    </div>
  );
}

export function StateView({
  type,
  title,
  description,
  action,
  requestId,
}: {
  type: "empty" | "error" | "loading";
  title: string;
  description: string;
  action?: ReactNode;
  requestId?: string;
}) {
  const { t } = useLocale();
  const Icon =
    type === "empty" ? Inbox : type === "error" ? FileWarning : RefreshCw;
  return (
    <div className={`${type}-state`}>
      <div className="state-icon">
        <Icon size={18} className={type === "loading" ? "spin" : undefined} />
      </div>
      <h3 className="state-title">{title}</h3>
      <p className="state-copy">{description}</p>
      {requestId && (
        <div className="error-detail">{t("requestId", { id: requestId })}</div>
      )}
      {action && <div style={{ marginTop: 16 }}>{action}</div>}
    </div>
  );
}

export function ServiceStatus({
  health,
  ready,
  onRefresh,
}: {
  health: "ok" | "error" | "loading";
  ready: "ok" | "error" | "loading";
  onRefresh: () => void;
}) {
  const status = (value: string) =>
    value === "ok" ? (
      <span className="status-value">
        <span className="status-dot" />
        正常
      </span>
    ) : value === "loading" ? (
      <span className="status-value warning">
        <RefreshCw size={12} className="spin" />
        检查中
      </span>
    ) : (
      <span className="status-value warning">
        <span className="status-dot" />
        异常
      </span>
    );
  return (
    <div className="status-strip">
      <div className="status-line">
        <span>API health</span>
        {status(health)}
      </div>
      <div className="status-line">
        <span>Dependencies</span>
        {status(ready)}
      </div>
      <IconButton
        label="刷新服务状态"
        onClick={onRefresh}
        className="status-refresh"
      >
        <RefreshCw size={13} />
      </IconButton>
    </div>
  );
}

export function CopyId({ value }: { value: string }) {
  const { t } = useLocale();
  const copy = async () => {
    await navigator.clipboard?.writeText(value);
  };
  return (
    <button
      className="mono"
      onClick={copy}
      title={t("copyId")}
      style={{
        color: "var(--blue)",
        background: "none",
        border: 0,
        padding: 0,
      }}
    >
      {value.slice(0, 8)}… <Copy size={11} style={{ verticalAlign: "-2px" }} />
    </button>
  );
}

export function Brand({ admin = false }: { admin?: boolean }) {
  return (
    <div className="brand">
      <div className="brand-mark">
        <Database size={17} />
      </div>
      <div>
        <div className="brand-name">THCPN</div>
        <div className="brand-sub">
          {admin ? "SYSTEM CONTROL" : "RESEARCH NETWORK"}
        </div>
      </div>
    </div>
  );
}

export function MobileMenuButton({ onClick }: { onClick: () => void }) {
  const { t } = useLocale();
  return (
    <IconButton
      label={t("openNavigation")}
      className="mobile-menu"
      onClick={onClick}
    >
      <Menu size={18} />
    </IconButton>
  );
}
export function CloseButton({ onClick }: { onClick: () => void }) {
  const { t } = useLocale();
  return (
    <IconButton label={t("closeNavigation")} onClick={onClick}>
      <X size={18} />
    </IconButton>
  );
}
export function PermissionIcon() {
  return <ShieldAlert size={18} />;
}
export function WarningIcon() {
  return <AlertTriangle size={18} />;
}
export function SuccessIcon() {
  return <Check size={18} />;
}
