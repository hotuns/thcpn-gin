import { Children, isValidElement, type ButtonHTMLAttributes, type ComponentProps, type InputHTMLAttributes, type ReactElement, type ReactNode, type SelectHTMLAttributes } from "react";
import { Search } from "lucide-react";
import { cn } from "@thcpn/ui";
import { Button as ShadcnButton } from "./components/ui/button";
import { Badge as ShadcnBadge } from "./components/ui/badge";
import { Card } from "./components/ui/card";
import { Input } from "./components/ui/input";
import { Checkbox } from "./components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./components/ui/select";

export * from "@thcpn/ui";
export * from "./components/ui/dialog";
export * from "./components/ui/tabs";
export * from "./components/ui/select";
export * from "./components/ui/checkbox";
export * from "./components/ui/switch";
export * from "./components/ui/dropdown-menu";
export * from "./components/ui/tooltip";
export * from "./components/ui/popover";
export * from "./components/ui/command";
export * from "./components/ui/breadcrumb";
export * from "./components/ui/alert";
export * from "./components/ui/table";
export * from "./components/ui/sheet";
export * from "./components/ui/textarea";
export { Input };

export function Button({ variant = "primary", ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "ghost" | "danger" }) {
  const mapped = { primary: "default", secondary: "secondary", ghost: "ghost", danger: "destructive" }[variant] as "default" | "secondary" | "ghost" | "destructive";
  return <ShadcnButton variant={mapped} {...props} />;
}

export function IconButton({ label, className, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return <ShadcnButton aria-label={label} title={label} variant="outline" size="icon" className={cn("icon-btn", className)} {...props} />;
}

export function Badge({ tone = "neutral", children }: { tone?: "success" | "info" | "warning" | "danger" | "neutral"; children: ReactNode }) {
  const mapped = { success: "success", info: "info", warning: "warning", danger: "destructive", neutral: "secondary" }[tone] as "success" | "info" | "warning" | "destructive" | "secondary";
  return <ShadcnBadge variant={mapped}>{children}</ShadcnBadge>;
}
export const Tag = Badge;

export function TextInput({ leading, className, ...props }: InputHTMLAttributes<HTMLInputElement> & { leading?: ReactNode }) {
  return <span className={cn("shadcn-input-shell ui-input", className)}>{leading && <span className="ui-control-leading">{leading}</span>}<Input {...props} /></span>;
}
export function SearchInput(props: Omit<InputHTMLAttributes<HTMLInputElement>, "type">) {
  return <TextInput {...props} type="search" leading={<Search size={16} />} />;
}
export function CheckboxInput({ checked, disabled, onChange, "aria-label": ariaLabel }: Omit<InputHTMLAttributes<HTMLInputElement>, "type">) {
  return <Checkbox checked={checked} disabled={disabled} aria-label={ariaLabel} onCheckedChange={(next) => onChange?.({ target: { checked: next === true }, currentTarget: { checked: next === true } } as never)} />;
}
export function SelectInput({ leading, className, children, value, defaultValue, disabled, onChange, onValueChange, "aria-label": ariaLabel }: Omit<SelectHTMLAttributes<HTMLSelectElement>, "value" | "defaultValue"> & { leading?: ReactNode; value?: string | number; defaultValue?: string | number; onValueChange?: (value: string) => void }) {
  const options = Children.toArray(children).filter(isValidElement) as ReactElement<{ value?: string | number; children?: ReactNode; disabled?: boolean }>[];
  const placeholder = options.find(option => String(option.props.value ?? "") === "")?.props.children;
  const items = options.filter(option => String(option.props.value ?? "") !== "");
  const change = (next: string) => {
    onValueChange?.(next);
    onChange?.({ target: { value: next }, currentTarget: { value: next } } as never);
  };
  return <span className={cn("ui-select radix-select-control", className)}>{leading && <span className="ui-control-leading">{leading}</span>}<Select value={value === "" || value == null ? undefined : String(value)} defaultValue={defaultValue == null ? undefined : String(defaultValue)} disabled={disabled} onValueChange={change}><SelectTrigger aria-label={ariaLabel} className="ui-select-trigger"><SelectValue placeholder={placeholder}/></SelectTrigger><SelectContent>{items.map((option, index)=><SelectItem key={`${String(option.props.value)}-${index}`} value={String(option.props.value)} disabled={option.props.disabled}>{option.props.children}</SelectItem>)}</SelectContent></Select></span>;
}
export function Panel({ className, ...props }: ComponentProps<typeof Card>) {
  return <Card className={className} {...props} />;
}
