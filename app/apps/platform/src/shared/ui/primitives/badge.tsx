import type { HTMLAttributes } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@thcpn/ui";

const badgeVariants = cva("shadcn-badge badge", {
  variants: {
    variant: {
      default: "shadcn-badge-default",
      secondary: "shadcn-badge-secondary neutral",
      success: "shadcn-badge-success success",
      info: "shadcn-badge-info info",
      warning: "shadcn-badge-warning warning",
      destructive: "shadcn-badge-destructive danger",
    },
  },
  defaultVariants: { variant: "default" },
});

export function Badge({ className, variant, ...props }: HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}
