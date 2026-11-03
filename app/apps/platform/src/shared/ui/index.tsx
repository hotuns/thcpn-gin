import { Children, isValidElement, useState, type ButtonHTMLAttributes, type ComponentProps, type InputHTMLAttributes, type ReactElement, type ReactNode, type SelectHTMLAttributes } from "react";
import { Search } from "lucide-react";
import { cn } from "@thcpn/ui";
import { Button as ShadcnButton } from "./primitives/button";
import { Badge as ShadcnBadge } from "./primitives/badge";
import { Card } from "./primitives/card";
import { Input } from "./primitives/input";
import { Checkbox } from "./primitives/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./primitives/select";

export * from "@thcpn/ui";
export * from "./primitives/dialog";
export * from "./primitives/tabs";
export * from "./primitives/select";
export * from "./primitives/checkbox";
export * from "./primitives/switch";
export * from "./primitives/dropdown-menu";
export * from "./primitives/tooltip";
export * from "./primitives/popover";
export * from "./primitives/command";
export * from "./primitives/breadcrumb";
export * from "./primitives/alert";
export * from "./primitives/table";
export * from "./primitives/sheet";
export * from "./primitives/textarea";
export { Input };

export function Button({ variant = "primary", ...props }: Omit<ComponentProps<typeof ShadcnButton>, "variant"> & { variant?: "primary" | "secondary" | "ghost" | "danger" }) {
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
export function SelectInput({ leading, className, children, value, defaultValue, disabled, required, name, id, onBlur, onChange, onValueChange, "aria-label": ariaLabel, "aria-labelledby": ariaLabelledBy, "aria-describedby": ariaDescribedBy, "aria-invalid": ariaInvalid }: Omit<SelectHTMLAttributes<HTMLSelectElement>, "value" | "defaultValue" | "onBlur"> & { leading?: ReactNode; value?: string | number; defaultValue?: string | number; onValueChange?: (value: string) => void; onBlur?: ComponentProps<typeof SelectTrigger>["onBlur"] }) {
  const options = Children.toArray(children).filter(isValidElement) as ReactElement<{ value?: string | number; children?: ReactNode; disabled?: boolean }>[];
  const [uncontrolledValue, setUncontrolledValue] = useState(defaultValue ?? options[0]?.props.value ?? "");
  const selectedValue = value ?? uncontrolledValue;
  // Radix reserves an empty value for clearing; encode every option so “all/none” remains selectable.
  const encode = (input: string | number) => `option:${input}`;
  const change = (encoded: string) => {
    const next = encoded.slice("option:".length);
    if (value == null) setUncontrolledValue(next);
    onValueChange?.(next);
    onChange?.({ target: { value: next }, currentTarget: { value: next } } as never);
  };
  return <span className={cn("ui-select radix-select-control", className)}>{leading && <span className="ui-control-leading">{leading}</span>}{name && <input type="hidden" name={name} value={selectedValue} disabled={disabled} />}<Select value={encode(selectedValue)} disabled={disabled} required={required} onValueChange={change}><SelectTrigger id={id} onBlur={onBlur} aria-label={ariaLabel} aria-labelledby={ariaLabelledBy} aria-describedby={ariaDescribedBy} aria-invalid={ariaInvalid} className="ui-select-trigger"><SelectValue /></SelectTrigger><SelectContent>{options.map((option, index)=><SelectItem key={`${String(option.props.value)}-${index}`} value={encode(option.props.value ?? "")} disabled={option.props.disabled}>{option.props.children}</SelectItem>)}</SelectContent></Select></span>;
}
export function Panel({ className, ...props }: ComponentProps<typeof Card>) {
  return <Card className={className} {...props} />;
}
