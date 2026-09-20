import type { ButtonHTMLAttributes, ComponentProps, InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from "react";
import { ChevronDown, Search } from "lucide-react";
import { cn } from "@thcpn/ui";
import { Button as ShadcnButton } from "./components/ui/button";
import { Badge as ShadcnBadge } from "./components/ui/badge";
import { Card } from "./components/ui/card";
import { Input } from "./components/ui/input";

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
export function SelectInput({ leading, className, children, ...props }: SelectHTMLAttributes<HTMLSelectElement> & { leading?: ReactNode }) {
  return <span className={cn("shadcn-select-shell ui-select", className)}>{leading && <span className="ui-control-leading">{leading}</span>}<select {...props}>{children}</select><ChevronDown className="ui-control-chevron" size={15} /></span>;
}
export function Panel({ className, ...props }: ComponentProps<typeof Card>) {
  return <Card className={className} {...props} />;
}
