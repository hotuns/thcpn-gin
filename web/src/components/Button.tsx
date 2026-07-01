import type { ButtonHTMLAttributes, ReactNode } from "react";

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon?: ReactNode;
  variant?: ButtonVariant;
}

export function Button({ children, className = "", icon, type = "button", variant = "secondary", ...props }: ButtonProps) {
  const iconOnly = icon && !children;

  return (
    <button
      className={`btn btn-${variant}${iconOnly ? " btn-icon-only" : ""}${className ? ` ${className}` : ""}`}
      type={type}
      {...props}
    >
      {icon ? <span className="btn-icon">{icon}</span> : null}
      {children ? <span>{children}</span> : null}
    </button>
  );
}
