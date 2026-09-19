import { forwardRef, type ComponentPropsWithoutRef, type ElementRef } from "react";
import { Select as SelectPrimitive } from "radix-ui";
import { Check, ChevronDown, ChevronUp } from "lucide-react";
import { cn } from "@thcpn/ui";

export const Select = SelectPrimitive.Root;
export const SelectValue = SelectPrimitive.Value;
export const SelectTrigger = forwardRef<ElementRef<typeof SelectPrimitive.Trigger>, ComponentPropsWithoutRef<typeof SelectPrimitive.Trigger>>(
  ({ className, children, ...props }, ref) => <SelectPrimitive.Trigger ref={ref} className={cn("shadcn-select-trigger", className)} {...props}>{children}<SelectPrimitive.Icon><ChevronDown size={15} /></SelectPrimitive.Icon></SelectPrimitive.Trigger>,
);
SelectTrigger.displayName = "SelectTrigger";
export const SelectContent = forwardRef<ElementRef<typeof SelectPrimitive.Content>, ComponentPropsWithoutRef<typeof SelectPrimitive.Content>>(
  ({ className, children, position = "popper", ...props }, ref) => <SelectPrimitive.Portal><SelectPrimitive.Content ref={ref} className={cn("shadcn-select-content", className)} position={position} {...props}><SelectPrimitive.ScrollUpButton className="shadcn-select-scroll"><ChevronUp size={14} /></SelectPrimitive.ScrollUpButton><SelectPrimitive.Viewport className="shadcn-select-viewport">{children}</SelectPrimitive.Viewport><SelectPrimitive.ScrollDownButton className="shadcn-select-scroll"><ChevronDown size={14} /></SelectPrimitive.ScrollDownButton></SelectPrimitive.Content></SelectPrimitive.Portal>,
);
SelectContent.displayName = "SelectContent";
export const SelectItem = forwardRef<ElementRef<typeof SelectPrimitive.Item>, ComponentPropsWithoutRef<typeof SelectPrimitive.Item>>(
  ({ className, children, ...props }, ref) => <SelectPrimitive.Item ref={ref} className={cn("shadcn-select-item", className)} {...props}><span className="shadcn-select-indicator"><SelectPrimitive.ItemIndicator><Check size={14} /></SelectPrimitive.ItemIndicator></span><SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText></SelectPrimitive.Item>,
);
SelectItem.displayName = "SelectItem";
