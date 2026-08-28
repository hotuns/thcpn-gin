import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { Navigate, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, CheckCircle2, Link2, ScanLine } from "lucide-react";
import {
  api,
  formatApiError,
  type DeviceClaimCredential,
} from "@thcpn/api";
import { useWorkspace } from "@thcpn/workspace";
import { Button, Panel, StateView } from "@thcpn/ui";

export function DeviceClaimPage() {
  const { claimSlug = "" } = useParams();
  const navigate = useNavigate();
  const { workspaces, currentId } = useWorkspace();
  const [serialNo, setSerialNo] = useState("");
  const [code, setCode] = useState("");
  const [workspaceId, setWorkspaceId] = useState(currentId ?? "");
  const [projectId, setProjectId] = useState("");
  const [siteId, setSiteId] = useState("");
  const [resolved, setResolved] = useState<DeviceClaimCredential | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const credential = useMemo(
    () => claimSlug ? { claim_slug: claimSlug } : { serial_no: serialNo.trim(), code: code.trim() },
    [claimSlug, serialNo, code],
  );
  const projects = useQuery({
    queryKey: ["claim", "projects", workspaceId],
    queryFn: () => api.projects.list(workspaceId),
    enabled: Boolean(resolved && workspaceId),
  });
  const sites = useQuery({
    queryKey: ["claim", "sites", workspaceId, projectId],
    queryFn: () => api.sites.list(workspaceId, projectId),
    enabled: Boolean(resolved && workspaceId && projectId),
  });

  useEffect(() => {
    if (!workspaceId && currentId) setWorkspaceId(currentId);
  }, [currentId, workspaceId]);
  useEffect(() => {
    if (!claimSlug) return;
    setBusy(true);
    api.deviceClaims.resolve({ claim_slug: claimSlug })
      .then(setResolved)
      .catch(setError)
      .finally(() => setBusy(false));
  }, [claimSlug]);

  const resolve = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      setResolved(await api.deviceClaims.resolve(credential));
    } catch (nextError) {
      setError(nextError);
    } finally {
      setBusy(false);
    }
  };
  const claim = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await api.deviceClaims.claim({
        ...credential,
        workspace_id: workspaceId,
        ...(projectId ? { project_id: projectId } : {}),
        ...(siteId ? { site_id: siteId } : {}),
      }, crypto.randomUUID());
      navigate(`/devices/${encodeURIComponent(result.device_id)}`, {
        replace: true,
        state: { message: `已认领 ${result.device_name}` },
      });
    } catch (nextError) {
      setError(nextError);
    } finally {
      setBusy(false);
    }
  };

  if (claimSlug && busy && !resolved && !error)
    return <StateView type="loading" title="正在读取设备铭牌" description="正在验证永久认领凭证。" />;
  return (
    <div className="device-claim-page">
      <header className="device-claim-header">
        <ScanLine size={24} />
        <div><h1>认领设备</h1><p>将网关或标准站加入你的组织</p></div>
        <Button variant="secondary" onClick={() => navigate("/devices")}><ArrowLeft size={14} />返回设备</Button>
      </header>
      {error ? <StateView type="error" title="无法认领此设备" description={formatApiError(error).message} requestId={formatApiError(error).requestId} /> : null}
      {!resolved && !claimSlug ? (
        <Panel>
          <form className="device-claim-form" data-onboarding="claim-identity" onSubmit={resolve}>
            <label className="field"><span className="field-label">设备序列号</span><input autoCapitalize="characters" value={serialNo} onChange={(event) => setSerialNo(event.target.value)} placeholder="铭牌上的 SN" /></label>
            <label className="field"><span className="field-label">认领码</span><input autoCapitalize="characters" value={code} onChange={(event) => setCode(event.target.value)} placeholder="XXXX-XXXX-XX" /></label>
            <Button type="submit" disabled={busy || !serialNo.trim() || !code.trim()}><Link2 size={15} />验证设备</Button>
          </form>
        </Panel>
      ) : null}
      {resolved ? (
        <Panel>
          <div className="device-claim-device">
            <CheckCircle2 size={22} />
            <div><strong>{resolved.device_name}</strong><span>{resolved.device_type === "gateway" ? `网关 · 包含 ${resolved.child_count} 个节点` : "标准站"} · SN 尾号 {resolved.serial_no}</span></div>
          </div>
          <div className="device-claim-form" data-onboarding="claim-assignment">
            <label className="field"><span className="field-label">目标组织</span><select value={workspaceId} onChange={(event) => { setWorkspaceId(event.target.value); setProjectId(""); setSiteId(""); }}>{workspaces.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
            <label className="field"><span className="field-label">项目（可选）</span><select value={projectId} onChange={(event) => { setProjectId(event.target.value); setSiteId(""); }}><option value="">不分配项目</option>{(projects.data?.items ?? []).map((item) => <option key={String(item.id)} value={String(item.id)}>{String(item.name)}</option>)}</select></label>
            <label className="field"><span className="field-label">站点（可选）</span><select disabled={!projectId} value={siteId} onChange={(event) => setSiteId(event.target.value)}><option value="">不分配站点</option>{(sites.data?.items ?? []).map((item) => <option key={String(item.id)} value={String(item.id)}>{String(item.name)}</option>)}</select></label>
            <Button disabled={busy || !workspaceId} onClick={() => void claim()}>确认认领</Button>
          </div>
        </Panel>
      ) : null}
    </div>
  );
}
