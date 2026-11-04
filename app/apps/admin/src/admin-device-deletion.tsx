import { useState } from "react";
import { Alert, App, Button, Descriptions, Form, Input, Modal, Space, Spin } from "antd";
import { api, formatApiError, type DeviceDeletion, type JsonRecord } from "@thcpn/api";

type Target = { deviceId: string; label: string } | { sourceId: string; sn: string; nodeId: number };

export function AdminDeviceDeletion({ target, onDeleted, onChanged, pending = false }: {
  target: Target;
  onDeleted: () => void;
  onChanged?: () => void;
  pending?: boolean;
}) {
  const { message } = App.useApp();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<DeviceDeletion>();
  const [failure, setFailure] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [reason, setReason] = useState("");
  const request = (input?: JsonRecord) => "deviceId" in target
    ? api.admin.deviceDeletion(target.deviceId, input)
    : api.admin.physicalNodeDeletion(target.sourceId, target.sn, target.nodeId, input);

  async function check() {
    setResult(undefined);
    setFailure("");
    setBusy(true);
    try { setResult(await request()); }
    catch (error) { setFailure(formatApiError(error).message); }
    finally { setBusy(false); }
  }

  const canSubmit = !busy && result?.allowed && result.state !== "unknown" &&
    confirmation.trim() === result.confirmation && !!reason.trim();

  async function remove() {
    if (!canSubmit || !result) return;
    setBusy(true);
    setFailure("");
    try {
      const response = await request({ confirmation: confirmation.trim(), reason: reason.trim(), expected_id: result.expected_id });
      if (response.state === "deleted") {
        setOpen(false);
        void message.success("已永久删除");
        onDeleted();
      } else {
        setResult(response);
        onChanged?.();
      }
    } catch (error) {
      setFailure(formatApiError(error).message);
      onChanged?.();
    } finally { setBusy(false); }
  }

  const recovery = result?.state === "partial";
  const reasonLabel = result?.confirmation === ("deviceId" in target ? target.deviceId : undefined) ? "设备 ID" : "SN";
  return <>
    <Button danger onClick={() => { setOpen(true); setConfirmation(""); setReason(""); void check(); }}>
      {pending ? `检查待清理节点 · ${"sn" in target ? target.sn : ""}` : "删除设备"}
    </Button>
    <Modal title={recovery ? "继续清理设备" : "永久删除设备"} open={open}
      okText={recovery ? "继续清理" : "永久删除"} okButtonProps={{ danger: true, disabled: !canSubmit }}
      confirmLoading={busy} closable={!busy} maskClosable={false} cancelButtonProps={{ disabled: busy }}
      onCancel={() => { if (!busy) setOpen(false); }} onOk={() => void remove()}>
      <Space orientation="vertical" size="middle" style={{ width: "100%" }}>
        {busy && !result && <Spin />}
        {failure && <Alert type="error" title={failure} />}
        {result && <>
          <Descriptions size="small" column={1} items={[
            { key: "name", label: "名称", children: result.name },
            { key: "type", label: "设备类型", children: "label" in target ? target.label : result.device_type },
            { key: "sn", label: reasonLabel, children: result.confirmation },
            { key: "scope", label: "删除范围", children: result.scope || "当前设备不可删除" },
          ]} />
          {recovery && <Alert type="warning" title="源端已删除，平台待清理" />}
          {result.reasons.length > 0 && <Alert type="warning" title={result.state === "unknown" ? "删除结果待核对" : "删除检查结果"}
            description={<ul>{result.reasons.map(item => <li key={item}>{item}</li>)}</ul>} />}
          {result.allowed && result.state !== "unknown" && <Form layout="vertical">
            <Form.Item label={`输入完整${reasonLabel}`} required><Input value={confirmation} onChange={event => setConfirmation(event.target.value)} /></Form.Item>
            <Form.Item label="删除原因" required><Input.TextArea value={reason} maxLength={300} rows={3} onChange={event => setReason(event.target.value)} /></Form.Item>
          </Form>}
        </>}
        {(failure || result?.state === "unknown" || recovery) && <Button disabled={busy} onClick={() => void check()}>重新检查</Button>}
      </Space>
    </Modal>
  </>;
}
