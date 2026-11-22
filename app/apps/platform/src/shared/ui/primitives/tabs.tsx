import { forwardRef, type ComponentPropsWithoutRef, type ElementRef } from "react";
import { Tabs as TabsPrimitive } from "radix-ui";
import { cn } from "@thcpn/ui";

export const Tabs = TabsPrimitive.Root;
type TabsListProps = ComponentPropsWithoutRef<typeof TabsPrimitive.List> & {
  variant?: "segmented" | "underline";
};

export const TabsList = forwardRef<ElementRef<typeof TabsPrimitive.List>, TabsListProps>(
  ({ className, variant = "segmented", ...props }, ref) => (
    <TabsPrimitive.List
      ref={ref}
      className={cn("shadcn-tabs-list", variant === "underline" && "shadcn-tabs-underline", className)}
      {...props}
    />
  ),
);
TabsList.displayName = "TabsList";
export const TabsTrigger = forwardRef<ElementRef<typeof TabsPrimitive.Trigger>, ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>>(
  ({ className, ...props }, ref) => <TabsPrimitive.Trigger ref={ref} className={cn("shadcn-tabs-trigger", className)} {...props} />,
);
TabsTrigger.displayName = "TabsTrigger";
export const TabsContent = forwardRef<ElementRef<typeof TabsPrimitive.Content>, ComponentPropsWithoutRef<typeof TabsPrimitive.Content>>(
  ({ className, ...props }, ref) => <TabsPrimitive.Content ref={ref} className={cn("shadcn-tabs-content", className)} {...props} />,
);
TabsContent.displayName = "TabsContent";
