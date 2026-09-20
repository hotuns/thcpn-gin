import type { ComponentPropsWithoutRef } from "react";
import { ChevronRight } from "lucide-react";
import { Link, type LinkProps } from "react-router-dom";
import { cn } from "@thcpn/ui";

export function Breadcrumb({ className, ...props }: ComponentPropsWithoutRef<"nav">) {
  return <nav aria-label="breadcrumb" className={cn("shadcn-breadcrumb", className)} {...props}/>;
}

export function BreadcrumbList({ className, ...props }: ComponentPropsWithoutRef<"ol">) {
  return <ol className={cn("shadcn-breadcrumb-list", className)} {...props}/>;
}

export function BreadcrumbItem({ className, ...props }: ComponentPropsWithoutRef<"li">) {
  return <li className={cn("shadcn-breadcrumb-item", className)} {...props}/>;
}

export function BreadcrumbLink({ className, ...props }: LinkProps) {
  return <Link className={cn("shadcn-breadcrumb-link", className)} {...props}/>;
}

export function BreadcrumbPage({ className, ...props }: ComponentPropsWithoutRef<"span">) {
  return <span aria-current="page" className={cn("shadcn-breadcrumb-page", className)} {...props}/>;
}

export function BreadcrumbSeparator({ className, ...props }: ComponentPropsWithoutRef<"li">) {
  return <li role="presentation" aria-hidden="true" className={cn("shadcn-breadcrumb-separator", className)} {...props}><ChevronRight size={14}/></li>;
}
