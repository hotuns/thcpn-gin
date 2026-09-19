import { forwardRef, type ComponentPropsWithoutRef, type ElementRef } from "react";
import { Switch as SwitchPrimitive } from "radix-ui";
import { cn } from "@thcpn/ui";

export const Switch = forwardRef<ElementRef<typeof SwitchPrimitive.Root>, ComponentPropsWithoutRef<typeof SwitchPrimitive.Root>>(
  ({ className, ...props }, ref) => <SwitchPrimitive.Root ref={ref} className={cn("shadcn-switch", className)} {...props}><SwitchPrimitive.Thumb className="shadcn-switch-thumb" /></SwitchPrimitive.Root>,
);
Switch.displayName = "Switch";
