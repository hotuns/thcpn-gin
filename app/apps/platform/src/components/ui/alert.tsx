import { forwardRef, type HTMLAttributes } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@thcpn/ui";

const alertVariants = cva("shadcn-alert", {
  variants: { variant: { default: "shadcn-alert-default", destructive: "shadcn-alert-destructive" } },
  defaultVariants: { variant: "default" },
});

export const Alert = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement> & VariantProps<typeof alertVariants>>(
  ({ className, variant, ...props }, ref) => <div ref={ref} role="alert" className={cn(alertVariants({ variant }), className)} {...props}/>,
);
Alert.displayName = "Alert";

export function AlertTitle({ className, ...props }: HTMLAttributes<HTMLHeadingElement>) {
  return <h5 className={cn("shadcn-alert-title", className)} {...props}/>;
}

export function AlertDescription({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("shadcn-alert-description", className)} {...props}/>;
}
