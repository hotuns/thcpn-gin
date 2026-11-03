import { forwardRef, type ComponentPropsWithoutRef, type ElementRef } from "react";
import { DropdownMenu as DropdownPrimitive } from "radix-ui";
import { cn } from "@thcpn/ui";

export const DropdownMenu = DropdownPrimitive.Root;
export const DropdownMenuTrigger = DropdownPrimitive.Trigger;
export const DropdownMenuContent = forwardRef<ElementRef<typeof DropdownPrimitive.Content>, ComponentPropsWithoutRef<typeof DropdownPrimitive.Content>>(
  ({ className, sideOffset = 8, ...props }, ref) => <DropdownPrimitive.Portal><DropdownPrimitive.Content ref={ref} sideOffset={sideOffset} className={cn("shadcn-dropdown-content", className)} {...props} /></DropdownPrimitive.Portal>,
);
DropdownMenuContent.displayName = "DropdownMenuContent";
export const DropdownMenuItem = forwardRef<ElementRef<typeof DropdownPrimitive.Item>, ComponentPropsWithoutRef<typeof DropdownPrimitive.Item>>(
  ({ className, ...props }, ref) => <DropdownPrimitive.Item ref={ref} className={cn("shadcn-dropdown-item", className)} {...props} />,
);
DropdownMenuItem.displayName = "DropdownMenuItem";
export const DropdownMenuSeparator = forwardRef<ElementRef<typeof DropdownPrimitive.Separator>, ComponentPropsWithoutRef<typeof DropdownPrimitive.Separator>>(
  ({ className, ...props }, ref) => <DropdownPrimitive.Separator ref={ref} className={cn("shadcn-dropdown-separator", className)} {...props} />,
);
DropdownMenuSeparator.displayName = "DropdownMenuSeparator";
