import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, App, Button, Descriptions, Form, InputNumber, Modal, Space, Typography } from "antd";
import { api, formatApiError } from "@thcpn/api";

type Result = Awaited<ReturnType<typeof api.admin.updateLoRaWANV2NodeCount>>;

export function GatewayNodeCount({ deviceId }: { deviceId: string }) {
  const { message } = App.useApp();
  const client = useQueryClient();
  const [open, setOpen] = useState(false);
  const [target, setTarget] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<Result>();
  const [reconcileCount, setReconcileCount] = useState<number>();
  const gateway = useQuery({
    queryKey: ["admin", "device", deviceId, "upstream-node-count"],
    enabled: open,
    staleTime: 0,
    queryFn: async () => {
      const ref = await api.admin.deviceLoRaWANV2Context(deviceId);
      const data = await api.admin.loraWANV2Gateway(String(ref.data_source_id), String(ref.gateway_sn));
      const count = Number(data.node_count);
      if (!Number.isInteger(count) || count < 0 || count > 254) throw new Error("源端节点数量无效，无法增加节点");
      return { sn: String(data.sn), count };
    },
  });
  useEffect(() => {
    if (open && gateway.data && !gateway.isFetching && target == null) setTarget(Math.min(254, gateway.data.count + 1));
  }, [open, gateway.data, gateway.isFetching, target]);
  const count = reconcileCount ?? result?.gateway.node_count ?? gateway.data?.count;
  const retry = result?.status === "partial" || reconcileCount != null;
  const valid = count != null && target != null && Number.isInteger(target) && target <= 254 && (retry ? target === count : target > count);
  const submit = async () => {
    if (!valid || target == null) return;
    setBusy(true); setError("");
    try {
      const response = await api.admin.updateLoRaWANV2NodeCount(deviceId, target);
      setResult(response);
      await Promise.all([
        client.invalidateQueries({ queryKey: ["admin", "devices"] }),
        client.invalidateQueries({ predicate: query => query.queryKey.includes("admin") && query.queryKey.includes(deviceId) }),
      ]);
      if (response.status === "completed") {
        if (response.warnings.length) void message.warning(response.warnings.map(item => item.message).join("；"));
        else void message.success("源端节点数量及平台节点列表已更新；请继续设置新节点的传感器与采集时间");
        setOpen(false);
      } else setTarget(response.gateway.node_count);
    } catch (err) {
      setError(formatApiError(err).message);
      // A failed HTTP response may follow a committed source update. Always
      // read the source before offering another submission.
      const latest = await gateway.refetch();
      if (latest.data && latest.data.count >= target) { setReconcileCount(latest.data.count); setTarget(latest.data.count); }
    } finally { setBusy(false); }
  };
  return <>
    <Button onClick={() => { setResult(undefined); setReconcileCount(undefined); setError(""); setTarget(null); setOpen(true); }}>增加节点</Button>
    <Modal title="增加 LoRa V2 网关节点" open={open} width={560} onCancel={() => { if (!busy) setOpen(false); }} onOk={() => void submit()} confirmLoading={busy} okText={retry ? "重试平台同步" : "确认增加节点"} okButtonProps={{ disabled: !valid || gateway.isFetching || !!gateway.error }}>
      <Space orientation="vertical" size="middle" style={{ width: "100%" }}>
        <Alert type="warning" title="节点数量只能增加，不能减少" description="按节点编号连续扩展，不创建独立设备。新增节点仍需设置传感器配置与采集时间；源端保存不代表硬件已生效。" />
        {(error || gateway.error) && <Alert type="error" title={error || formatApiError(gateway.error).message} action={<Button onClick={() => void gateway.refetch()} loading={gateway.isFetching}>重新读取</Button>} />}
        <Descriptions size="small" column={1} items={[{ key: "sn", label: "网关 SN", children: gateway.data?.sn ?? "正在读取…" }, { key: "count", label: "源端当前节点数", children: count ?? "正在读取…" }]} />
        <Form layout="vertical">
          <Form.Item label="目标节点总数" required extra={retry ? "重试仅补同步平台，不会重复增加源端节点。" : count === 254 ? "已达到 254 个节点的上限。" : valid ? `将新增节点 ${count! + 1}${target! > count! + 1 ? `–${target}` : ""}，共 ${target! - count!} 个。` : "请输入大于当前数量的整数，最大 254。"}>
            <InputNumber aria-label="目标节点总数" value={target} precision={0} min={retry ? count : (count ?? 0) + 1} max={254} disabled={busy || gateway.isFetching || retry || count === 254} onChange={setTarget} style={{ width: "100%" }} />
          </Form.Item>
        </Form>
        {result && <Alert type="warning" title="源端已保存，平台尚未完成同步" description={<>{result.warnings.map(warning => <div key={warning.code}>{warning.message}</div>)}<Typography.Text copyable>操作 ID：{result.write_state.operation_id}</Typography.Text></>} />}
      </Space>
    </Modal>
  </>;
}
