import { Button as AntButton, type ButtonProps as AntButtonProps } from "antd";
import type { ReactNode } from "react";

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";

interface ButtonProps extends Omit<AntButtonProps, "danger" | "htmlType" | "type" | "variant"> {
  icon?: ReactNode;
  type?: "button" | "submit" | "reset";
  variant?: ButtonVariant;
}

export function Button({ children, className = "", icon, type = "button", variant = "secondary", ...props }: ButtonProps) {
  const iconOnly = icon && !children;
  const antType = variant === "primary" ? "primary" : variant === "ghost" ? "text" : "default";

  return (
    <AntButton
      className={`${iconOnly ? "btn-icon-only" : ""}${className ? ` ${className}` : ""}`}
      danger={variant === "danger"}
      htmlType={type}
      icon={icon}
      type={antType}
      {...props}
    >
      {children}
    </AntButton>
  );
}
