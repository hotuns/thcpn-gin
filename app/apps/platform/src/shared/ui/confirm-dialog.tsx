import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";
import { useLocale } from "@thcpn/i18n";
import { Button } from "./primitives/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./primitives/dialog";

export interface ConfirmOptions {
  title?: string;
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: "default" | "danger";
}

type ConfirmFn = (options: ConfirmOptions | string) => Promise<boolean>;

interface PendingConfirm {
  title: string;
  description: string;
  confirmLabel: string;
  cancelLabel: string;
  tone: "default" | "danger";
}

const ConfirmContext = createContext<ConfirmFn | null>(null);

export function ConfirmDialogProvider({ children }: { children: ReactNode }) {
  const { locale } = useLocale();
  const isZh = locale.toLowerCase().startsWith("zh");
  const [pending, setPending] = useState<PendingConfirm | null>(null);
  const resolverRef = useRef<((confirmed: boolean) => void) | null>(null);

  const settle = useCallback((confirmed: boolean) => {
    const resolve = resolverRef.current;
    resolverRef.current = null;
    setPending(null);
    resolve?.(confirmed);
  }, []);

  const confirm = useCallback<ConfirmFn>(
    (input) => {
      if (resolverRef.current) {
        resolverRef.current(false);
        resolverRef.current = null;
      }
      const options: ConfirmOptions =
        typeof input === "string" ? { description: input } : input;
      const tone = options.tone ?? "default";
      const defaultTitle =
        tone === "danger"
          ? isZh
            ? "确认此操作"
            : "Confirm action"
          : isZh
            ? "请确认"
            : "Please confirm";
      const defaultConfirm =
        tone === "danger"
          ? isZh
            ? "确认执行"
            : "Confirm"
          : isZh
            ? "确定"
            : "Confirm";
      const defaultCancel = isZh ? "取消" : "Cancel";

      return new Promise<boolean>((resolve) => {
        resolverRef.current = resolve;
        setPending({
          title: options.title ?? defaultTitle,
          description: options.description,
          confirmLabel: options.confirmLabel ?? defaultConfirm,
          cancelLabel: options.cancelLabel ?? defaultCancel,
          tone,
        });
      });
    },
    [isZh],
  );

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <Dialog
        open={pending !== null}
        onOpenChange={(open) => {
          if (!open) settle(false);
        }}
      >
        {pending && (
          <DialogContent className="shadcn-confirm-dialog">
            <DialogHeader>
              <DialogTitle>{pending.title}</DialogTitle>
              <DialogDescription className="shadcn-confirm-description">
                {pending.description}
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button type="button" variant="secondary" onClick={() => settle(false)}>
                {pending.cancelLabel}
              </Button>
              <Button
                type="button"
                variant={pending.tone === "danger" ? "destructive" : "default"}
                onClick={() => settle(true)}
                autoFocus
              >
                {pending.confirmLabel}
              </Button>
            </DialogFooter>
          </DialogContent>
        )}
      </Dialog>
    </ConfirmContext.Provider>
  );
}

export function useConfirm(): ConfirmFn {
  const ctx = useContext(ConfirmContext);
  return useCallback<ConfirmFn>(
    (input) => {
      if (ctx) return ctx(input);
      const message = typeof input === "string" ? input : input.description;
      return Promise.resolve(window.confirm(message));
    },
    [ctx],
  );
}
