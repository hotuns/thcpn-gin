import { forwardRef, type ComponentPropsWithoutRef, type ElementRef } from "react";
import { Checkbox as CheckboxPrimitive } from "radix-ui";
import { Check } from "lucide-react";
import { cn } from "@thcpn/ui";

export const Checkbox = forwardRef<ElementRef<typeof CheckboxPrimitive.Root>, ComponentPropsWithoutRef<typeof CheckboxPrimitive.Root>>(
  ({ className, ...props }, ref) => <CheckboxPrimitive.Root ref={ref} className={cn("shadcn-checkbox", className)} {...props}><CheckboxPrimitive.Indicator className="shadcn-checkbox-indicator"><Check size={13} /></CheckboxPrimitive.Indicator></CheckboxPrimitive.Root>,
);
Checkbox.displayName = "Checkbox";
