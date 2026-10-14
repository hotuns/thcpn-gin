import { useState } from "react";
import { useLocale } from "@thcpn/i18n";
import { Alert, Button, Input, Modal } from "@thcpn/admin-ui";
import { formatApiError } from "@thcpn/api";

export function AdminNodeNameEditor({ name, onSave, allowEmpty = true }: {
  name: string; onSave: (name: string) => Promise<unknown>; allowEmpty?: boolean;
}) {
  const { locale } = useLocale();
  const text = (zh: string, en: string) => locale === "zh-CN" ? zh : en;
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(name);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const save = async () => {
    if (busy) return;
    const value = draft.trim();
    if (!allowEmpty && !value) { setError(text("请输入节点名称。", "Enter a node name.")); return; }
    if (Array.from(value).length > 50 || /[\p{Cc}\u2028\u2029]/u.test(draft)) {
      setError(text("名称最多 50 个字符，不能包含换行或控制字符。", "Names may contain up to 50 characters, without line breaks or control characters.")); return;
    }
    setBusy(true); setError("");
    try { await onSave(value); setOpen(false); }
    catch (e) { setError(formatApiError(e).message); }
    finally { setBusy(false); }
  };
  return <span onClick={event => event.stopPropagation()}>
    <Button size="small" onClick={() => { setDraft(name); setError(""); setOpen(true); }}>{text("编辑名称", "Edit name")}</Button>
    <Modal title={text("编辑节点名称", "Edit node name")} open={open} onCancel={() => { if (!busy) setOpen(false); }} onOk={() => void save()} confirmLoading={busy} closable={!busy} maskClosable={!busy} keyboard={!busy} cancelButtonProps={{disabled:busy}} okText={text("保存", "Save")} cancelText={text("取消", "Cancel")} destroyOnHidden>
      <label style={{display:"grid",gap:8}}><span>{text("节点名称", "Node name")}</span><Input autoFocus aria-label={text("节点名称", "Node name")} value={draft} disabled={busy} onChange={event => setDraft(event.target.value)} onPressEnter={() => void save()}/></label>
      <p>{allowEmpty && text("留空恢复节点序号显示。", "Leave empty to restore the default node label.")}{text("修改后所有使用该设备的空间均可见。", "Changes are visible in every workspace using this device.")}</p>
      {error && <Alert type="error" showIcon title={error} />}
    </Modal>
  </span>;
}
