import { useMemo, useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, Download, Globe2, LockKeyhole, Pencil, Printer, X } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { api, formatApiError, type Device, type DevicePublicAccess } from "@thcpn/api";
import { Badge, Button, Panel, StateView } from "@thcpn/ui";

const formatTime = (value?: string) => value
  ? new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value))
  : "—";

export function DevicePublicAccessPanel({ device }: { device: Device }) {
  const client = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [feedback, setFeedback] = useState("");
  const query = useQuery({
    queryKey: ["device", device.id, "public-access"],
    queryFn: () => api.devices.publicAccess(device.id),
    retry: false,
  });
  const forbidden = formatApiError(query.error).status === 403;
  const publication = query.data;
  const publicUrl = useMemo(
    () => publication?.public_slug ? `${window.location.origin}/public/devices/${publication.public_slug}` : "",
    [publication?.public_slug],
  );
  if (forbidden) return null;
  if (query.isLoading) return <Panel><StateView type="loading" title="正在加载公开访问" description="正在读取设备公开设置。" /></Panel>;
  if (query.error) return <Panel><StateView type="error" title="公开访问加载失败" description={formatApiError(query.error).message} requestId={formatApiError(query.error).requestId} /></Panel>;

  const copyUrl = async () => {
    await navigator.clipboard.writeText(publicUrl);
    setFeedback("公开地址已复制");
  };
  const downloadQR = () => {
    const source = document.getElementById(`public-device-qr-${device.id}`);
    if (!source) return;
    const blob = new Blob([new XMLSerializer().serializeToString(source)], { type: "image/svg+xml;charset=utf-8" });
    const href = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = href;
    link.download = `${device.name}-公开访问二维码.svg`;
    link.click();
    URL.revokeObjectURL(href);
  };
  const printQR = () => {
    const source = document.getElementById(`public-device-qr-${device.id}`);
    if (!source) return;
    const popup = window.open("", "_blank", "width=520,height=620");
    if (!popup) return;
    popup.document.write(`<title>${device.name}</title><style>body{font-family:system-ui;text-align:center;padding:48px}svg{width:320px;height:320px}h1{font-size:20px}p{word-break:break-all;color:#475569}</style><h1>${escapeHTML(device.name)}</h1>${new XMLSerializer().serializeToString(source)}<p>${escapeHTML(publicUrl)}</p>`);
    popup.document.close();
    popup.focus();
    popup.print();
  };
  return (
    <>
      <Panel className="device-public-access-panel">
        <div className="panel-header compact-panel-header">
          <div className="public-access-title"><Globe2 size={16} /><h2 className="panel-title">公开访问</h2></div>
          <div className="header-actions">
            <Badge tone={publication?.enabled ? "success" : "neutral"}>{publication?.enabled ? "已公开" : "未公开"}</Badge>
            {publication?.password_enabled && <Badge tone="info"><LockKeyhole size={12} />密码保护</Badge>}
            <Button variant="secondary" onClick={() => setEditing(true)}><Pencil size={14} />设置</Button>
          </div>
        </div>
        {publication?.public_slug ? (
          <div className="public-access-body">
            <div className="public-access-details">
              <label className="field"><span className="field-label">固定公开地址</span><div className="public-url-row"><input readOnly value={publicUrl} /><Button variant="secondary" onClick={() => void copyUrl()}><Copy size={14} />复制</Button></div></label>
              <div className="public-access-meta">关闭后地址仍会保留，重新开启无需更换设备二维码。</div>
              <div className="public-access-meta">更新于 {formatTime(publication.updated_at)}{publication.updated_by_name ? ` · ${publication.updated_by_name}` : ""}</div>
              {feedback && <div className="command-note">{feedback}</div>}
            </div>
            <div className="public-qr-block">
              <QRCodeSVG id={`public-device-qr-${device.id}`} value={publicUrl} size={136} level="M" marginSize={2} />
              <div className="public-qr-actions"><Button variant="secondary" onClick={downloadQR}><Download size={14} />下载</Button><Button variant="secondary" onClick={printQR}><Printer size={14} />打印</Button></div>
            </div>
          </div>
        ) : <StateView type="empty" title="设备尚未公开" description="开启后会生成永久固定地址和二维码。" />}
      </Panel>
      {editing && <PublicAccessEditor device={device} current={publication} onClose={() => setEditing(false)} onSaved={async (result) => { client.setQueryData(["device", device.id, "public-access"], result); setEditing(false); setFeedback(result.enabled ? "公开访问设置已更新" : "公开访问已关闭"); }} />}
    </>
  );
}

function PublicAccessEditor({ device, current, onClose, onSaved }: { device: Device; current?: DevicePublicAccess; onClose: () => void; onSaved: (value: DevicePublicAccess) => Promise<void> }) {
  const [enabled, setEnabled] = useState(Boolean(current?.enabled));
  const [passwordEnabled, setPasswordEnabled] = useState(Boolean(current?.password_enabled));
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (passwordEnabled && !current?.password_enabled && password.length < 8) { setError("访问密码至少需要 8 个字符"); return; }
    const action = enabled ? "应用公开访问设置" : "关闭设备公开访问";
    if (!window.confirm(`确认${action}？`)) return;
    setBusy(true); setError("");
    try {
      const result = await api.devices.updatePublicAccess(device.id, { enabled, password_enabled: passwordEnabled, ...(password ? { password } : {}) });
      await onSaved(result);
    } catch (reason) {
      const item = formatApiError(reason);
      setError(`${item.message}${item.requestId ? ` · request id ${item.requestId}` : ""}`);
    } finally { setBusy(false); }
  };
  return <div className="modal-layer"><button className="modal-backdrop" aria-label="关闭公开访问设置" onClick={onClose} /><div className="modal-card public-access-editor" role="dialog" aria-modal="true"><div className="panel-header"><h2 className="panel-title">公开访问设置</h2><Button variant="secondary" onClick={onClose}><X size={14} />关闭</Button></div><form className="panel-body public-access-form" onSubmit={submit}><label className="setting-toggle"><span><strong>公开设备</strong><small>任何人可通过固定地址查看最近三天数据和图片</small></span><input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} /></label><label className="setting-toggle"><span><strong>访问密码</strong><small>验证后在当前浏览器保持 7 天</small></span><input type="checkbox" checked={passwordEnabled} onChange={(event) => setPasswordEnabled(event.target.checked)} /></label>{passwordEnabled && <label className="field"><span className="field-label">{current?.password_enabled ? "设置新密码（不修改可留空）" : "访问密码"}</span><input type="password" minLength={8} maxLength={72} value={password} onChange={(event) => setPassword(event.target.value)} placeholder="8–72 个字符" /></label>}{error && <div className="command-note error-note">{error}</div>}<div className="form-actions"><Button type="button" variant="secondary" onClick={onClose}>取消</Button><Button type="submit" disabled={busy}>{busy ? "正在保存…" : "确认保存"}</Button></div></form></div></div>;
}

const escapeHTML = (value: string) => value.replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char] ?? char);
