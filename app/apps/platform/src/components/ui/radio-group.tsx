import { forwardRef, type ComponentPropsWithoutRef, type ElementRef } from "react";
import { RadioGroup as RadioPrimitive } from "radix-ui";
import { cn } from "@thcpn/ui";

export const RadioGroup = forwardRef<ElementRef<typeof RadioPrimitive.Root>, ComponentPropsWithoutRef<typeof RadioPrimitive.Root>>(
  ({ className, ...props }, ref) => <RadioPrimitive.Root ref={ref} className={cn("shadcn-radio-group", className)} {...props} />,
);
RadioGroup.displayName = "RadioGroup";
export const RadioGroupItem = forwardRef<ElementRef<typeof RadioPrimitive.Item>, ComponentPropsWithoutRef<typeof RadioPrimitive.Item>>(
  ({ className, ...props }, ref) => <RadioPrimitive.Item ref={ref} className={cn("shadcn-radio-group-item", className)} {...props}><RadioPrimitive.Indicator className="shadcn-radio-group-indicator" /></RadioPrimitive.Item>,
);
RadioGroupItem.displayName = "RadioGroupItem";
