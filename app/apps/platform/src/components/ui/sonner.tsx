import type { CSSProperties } from "react";
import { Toaster as Sonner, type ToasterProps } from "sonner";

export function Toaster(props: ToasterProps) {
  return (
    <Sonner
      className="platform-toaster"
      position="top-right"
      closeButton
      offset={{ top: 76, right: 24 }}
      mobileOffset={{ top: 72, right: 16, left: 16 }}
      style={{
        "--normal-bg": "var(--panel)",
        "--normal-text": "var(--ink)",
        "--normal-border": "var(--line)",
        "--width": "380px",
      } as CSSProperties}
      {...props}
    />
  );
}
