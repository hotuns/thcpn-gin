import { forwardRef, type InputHTMLAttributes } from "react";
import { cn } from "@thcpn/ui";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => <input ref={ref} className={cn("shadcn-input", className)} {...props} />,
);
Input.displayName = "Input";
