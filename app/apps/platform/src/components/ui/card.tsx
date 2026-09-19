import { forwardRef, type HTMLAttributes } from "react";
import { cn } from "@thcpn/ui";

export const Card = forwardRef<HTMLElement, HTMLAttributes<HTMLElement>>(
  ({ className, ...props }, ref) => <section ref={ref} className={cn("shadcn-card panel", className)} {...props} />,
);
Card.displayName = "Card";
