import { forwardRef, type ComponentPropsWithoutRef, type ElementRef } from "react";
import { Tooltip as TooltipPrimitive } from "radix-ui";
import { cn } from "@thcpn/ui";

export const TooltipProvider = TooltipPrimitive.Provider;
export const Tooltip = TooltipPrimitive.Root;
export const TooltipTrigger = TooltipPrimitive.Trigger;
export const TooltipContent = forwardRef<ElementRef<typeof TooltipPrimitive.Content>, ComponentPropsWithoutRef<typeof TooltipPrimitive.Content>>(
  ({ className, sideOffset = 6, ...props }, ref) => <TooltipPrimitive.Portal><TooltipPrimitive.Content ref={ref} sideOffset={sideOffset} className={cn("shadcn-tooltip-content", className)} {...props} /></TooltipPrimitive.Portal>,
);
TooltipContent.displayName = "TooltipContent";
