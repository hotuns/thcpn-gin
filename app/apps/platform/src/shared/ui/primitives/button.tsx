import { forwardRef, type ButtonHTMLAttributes } from "react";
import { Slot } from "radix-ui";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@thcpn/ui";

export const buttonVariants = cva("shadcn-button btn", {
  variants: {
    variant: {
      default: "shadcn-button-default btn-primary",
      secondary: "shadcn-button-secondary btn-secondary",
      ghost: "shadcn-button-ghost btn-ghost",
      destructive: "shadcn-button-destructive btn-danger",
      outline: "shadcn-button-outline btn-secondary",
    },
    size: {
      default: "shadcn-button-md",
      sm: "shadcn-button-sm",
      icon: "shadcn-button-icon",
    },
  },
  defaultVariants: { variant: "default", size: "default" },
});

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Component = asChild ? Slot.Slot : "button";
    return <Component ref={ref} className={cn(buttonVariants({ variant, size }), className)} {...props} />;
  },
);
Button.displayName = "Button";
