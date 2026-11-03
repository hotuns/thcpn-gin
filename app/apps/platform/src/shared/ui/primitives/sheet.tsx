import { forwardRef, type ComponentPropsWithoutRef, type ElementRef } from "react";
import { Dialog as SheetPrimitive } from "radix-ui";
import { X } from "lucide-react";
import { cn } from "@thcpn/ui";

export const Sheet = SheetPrimitive.Root;
export const SheetTrigger = SheetPrimitive.Trigger;
export const SheetClose = SheetPrimitive.Close;

export const SheetContent = forwardRef<
  ElementRef<typeof SheetPrimitive.Content>,
  ComponentPropsWithoutRef<typeof SheetPrimitive.Content> & { side?: "top" | "right" | "bottom" | "left" }
>(({ side = "right", className, children, ...props }, ref) => (
  <SheetPrimitive.Portal>
    <SheetPrimitive.Overlay className="shadcn-sheet-overlay" />
    <SheetPrimitive.Content
      ref={ref}
      className={cn("shadcn-sheet-content", `shadcn-sheet-${side}`, className)}
      aria-describedby={undefined}
      {...props}
    >
      {children}
      <SheetPrimitive.Close className="shadcn-sheet-close" aria-label="关闭">
        <X size={16} />
      </SheetPrimitive.Close>
    </SheetPrimitive.Content>
  </SheetPrimitive.Portal>
));
SheetContent.displayName = "SheetContent";

export const SheetHeader = ({ className, ...props }: ComponentPropsWithoutRef<"div">) => (
  <div className={cn("shadcn-sheet-header", className)} {...props} />
);
export const SheetFooter = ({ className, ...props }: ComponentPropsWithoutRef<"div">) => (
  <div className={cn("shadcn-sheet-footer", className)} {...props} />
);
export const SheetTitle = forwardRef<
  ElementRef<typeof SheetPrimitive.Title>,
  ComponentPropsWithoutRef<typeof SheetPrimitive.Title>
>(({ className, ...props }, ref) => (
  <SheetPrimitive.Title ref={ref} className={cn("shadcn-sheet-title", className)} {...props} />
));
SheetTitle.displayName = "SheetTitle";
export const SheetDescription = forwardRef<
  ElementRef<typeof SheetPrimitive.Description>,
  ComponentPropsWithoutRef<typeof SheetPrimitive.Description>
>(({ className, ...props }, ref) => (
  <SheetPrimitive.Description ref={ref} className={cn("shadcn-sheet-description", className)} {...props} />
));
SheetDescription.displayName = "SheetDescription";
