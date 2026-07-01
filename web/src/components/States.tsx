import { AlertTriangle, Inbox, LoaderCircle } from "lucide-react";
import { formatApiError } from "../api";
import { Button } from "./Button";

export function LoadingState({ label = "正在加载" }: { label?: string }) {
  return (
    <div className="state state-inline">
      <LoaderCircle className="spin" size={18} />
      <span>{label}</span>
    </div>
  );
}

export function EmptyState({ title, detail }: { title: string; detail?: string }) {
  return (
    <div className="state">
      <Inbox size={28} />
      <strong>{title}</strong>
      {detail ? <p>{detail}</p> : null}
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  return (
    <div className="state state-error">
      <AlertTriangle size={24} />
      <strong>请求未完成</strong>
      <p>{formatApiError(error)}</p>
      {onRetry ? (
        <Button onClick={onRetry} variant="secondary">
          重试
        </Button>
      ) : null}
    </div>
  );
}
