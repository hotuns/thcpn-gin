import { useEffect, useRef, useState } from "react";

export function NodeNameEditor({name, onSave, allowEmpty = true}: {
  name: string; onSave: (name: string) => Promise<unknown>; allowEmpty?: boolean;
}) {
  const [open,setOpen]=useState(false);
  const [draft,setDraft]=useState(name);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { if (open) dialog.current?.showModal(); }, [open]);
  const save=async()=>{
    if (busy) return;
    const value=draft.trim();
    if ((!allowEmpty&&!value)||Array.from(value).length>50||/[\p{Cc}\u2028\u2029]/u.test(draft)) {setError("名称最多 50 个字符，不能包含换行或控制字符。");return;}
    setBusy(true);setError("");
    try {await onSave(value);setOpen(false);} catch(e){setError(e instanceof Error?e.message:"保存失败，请重试");}finally{setBusy(false);}
  };
  return <span className="node-name-editor" onClick={e=>e.stopPropagation()}>
    <button type="button" className="button button-secondary" onClick={()=>{setDraft(name);setError("");setOpen(true);}}>编辑名称</button>
    {open&&<dialog ref={dialog} className="node-name-dialog" aria-label="编辑节点名称" onCancel={e=>{e.preventDefault();if(!busy)setOpen(false);}}>
      <h2 className="panel-title">编辑节点名称</h2>
      <label className="field"><span className="field-label">节点名称</span><input autoFocus value={draft} disabled={busy} onChange={e=>setDraft(e.target.value)} onKeyDown={e=>{if(e.key==="Enter"){e.preventDefault();void save();}if(e.key==="Escape"&&!busy)setOpen(false);}}/></label>
      <p>{allowEmpty?"留空恢复节点序号显示。":""}修改后所有使用该设备的空间均可见。</p>
      {error&&<span role="alert">{error}</span>}
      <span className="modal-actions"><button type="button" className="button button-secondary" disabled={busy} onClick={()=>setOpen(false)}>取消</button><button type="button" className="button button-primary" disabled={busy} onClick={()=>void save()}>{busy?"保存中…":"保存"}</button></span>
    </dialog>}
  </span>;
}
