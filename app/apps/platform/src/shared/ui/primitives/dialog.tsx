import { forwardRef, type ComponentPropsWithoutRef, type ElementRef } from "react";
import { Dialog as DialogPrimitive } from "radix-ui";
import { X } from "lucide-react";
import { cn } from "@thcpn/ui";

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

export const DialogContent = forwardRef<ElementRef<typeof DialogPrimitive.Content>, ComponentPropsWithoutRef<typeof DialogPrimitive.Content>>(
  ({ className, children, ...props }, ref) => (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="shadcn-dialog-overlay" />
      <DialogPrimitive.Content ref={ref} className={cn("shadcn-dialog-content", className)} {...props}>
        {children}
        <DialogPrimitive.Close className="shadcn-dialog-close" aria-label="关闭"><X size={16} /></DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  ),
);
DialogContent.displayName = "DialogContent";
export const DialogHeader = ({ className, ...props }: ComponentPropsWithoutRef<"div">) => <div className={cn("shadcn-dialog-header", className)} {...props} />;
export const DialogFooter = ({ className, ...props }: ComponentPropsWithoutRef<"div">) => <div className={cn("shadcn-dialog-footer", className)} {...props} />;
export const DialogTitle = forwardRef<ElementRef<typeof DialogPrimitive.Title>, ComponentPropsWithoutRef<typeof DialogPrimitive.Title>>(
  ({ className, ...props }, ref) => <DialogPrimitive.Title ref={ref} className={cn("shadcn-dialog-title", className)} {...props} />,
);
DialogTitle.displayName = "DialogTitle";
export const DialogDescription = forwardRef<ElementRef<typeof DialogPrimitive.Description>, ComponentPropsWithoutRef<typeof DialogPrimitive.Description>>(
  ({ className, ...props }, ref) => <DialogPrimitive.Description ref={ref} className={cn("shadcn-dialog-description", className)} {...props} />,
);
DialogDescription.displayName = "DialogDescription";
