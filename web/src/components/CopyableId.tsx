import { Copy } from "lucide-react";
import { Button } from "./Button";
import { useToast } from "./Toast";

export function CopyableId({ value }: { value?: string }) {
  const { pushToast } = useToast();

  if (!value) {
    return <span className="muted">-</span>;
  }

  return (
    <span className="copyable-id">
      <span className="mono" title={value}>
        {value}
      </span>
      <Button
        aria-label="复制 ID"
        icon={<Copy size={14} />}
        onClick={() => {
          void navigator.clipboard.writeText(value);
          pushToast("已复制");
        }}
        variant="ghost"
      />
    </span>
  );
}
