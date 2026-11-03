import { useId, useState, type ReactNode } from "react";
import { ArrowDown, ArrowUp, ChevronDown, ChevronUp } from "lucide-react";
import { Button } from "../../shared/ui";
import { useIsMobile } from "../../shared/hooks/use-mobile";
import "./device-mobile.css";

/** Collapse only the editor: draft state and applied results belong to the caller. */
export function DeviceQueryEditor({ summary, children }: { summary: ReactNode; children: ReactNode }) {
  const mobile = useIsMobile();
  const [open, setOpen] = useState(false);
  const id = useId();
  return <>
    {mobile && <div className="device-query-summary"><p>{summary}</p><Button variant="secondary" aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)}>{open ? <ChevronUp size={16}/> : <ChevronDown size={16}/>}{open ? "收起条件" : "编辑条件"}</Button></div>}
    <div id={id} hidden={mobile && !open} className="device-query-editor">{children}</div>
  </>;
}

export function MetricOption({ children }: { children: ReactNode }) {
  return useIsMobile() ? <div className="device-metric-option">{children}</div> : <>{children}</>;
}

export function MetricOrderControls({ name, id, selected, onChange }: { name: string; id: string; selected: string[]; onChange: (ids: string[]) => void }) {
  const mobile = useIsMobile();
  const index = selected.indexOf(id);
  if (!mobile || index < 0) return null;
  const move = (offset: number) => {
    const next = [...selected];
    next.splice(index + offset, 0, next.splice(index, 1)[0]);
    onChange(next);
  };
  return <span className="device-metric-order">
    <Button variant="secondary" aria-label={`上移 ${name}`} disabled={index === 0} onClick={() => move(-1)}><ArrowUp size={16}/></Button>
    <Button variant="secondary" aria-label={`下移 ${name}`} disabled={index === selected.length - 1} onClick={() => move(1)}><ArrowDown size={16}/></Button>
  </span>;
}
