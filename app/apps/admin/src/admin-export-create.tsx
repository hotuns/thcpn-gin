import { useMemo, useState } from "react";
import { useQueries } from "@tanstack/react-query";
import { Alert, App, Button, Checkbox, Flex, Form, Modal, Radio, Select, Space, Typography } from "antd";
import dayjs, { type Dayjs } from "dayjs";
import { api, formatApiError, nodeOptionLabel, type JsonRecord } from "@thcpn/api";
import { adminDeviceCategories, matchesAdminDeviceCategory } from "./admin-device-category-model";
import { operationsExportPayload, type OpsExportOptions } from "./admin-device-ops-model";
import { AdminTimeRange } from "./admin-time-range";

const exportCategories = [
  ...adminDeviceCategories.filter(({ key }) => key !== "node_v2"),
  { key: "gateway_node", label: "THCPN 组网节点" },
];
type ExportCategory = typeof exportCategories[number]["key"];

const deviceId = (device: JsonRecord) => String(device.id);
export const exportDeviceName = (device: JsonRecord) => String(device.name || device.asset_no || "未命名设备");
const exportDeviceLabel = (device: JsonRecord) => device.name && device.asset_no
  ? `${device.name} · ${device.asset_no}`
  : exportDeviceName(device);
const recentRange = (): [Dayjs, Dayjs] => [dayjs().subtract(7, "day"), dayjs()];
const carbonFields = ["A", "B", "C", "D"];

export function AdminExportCreate({ open, onClose, onCreated, device, devices, devicesLoading, devicesError, reloadDevices }: {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
  device?: JsonRecord;
  devices: JsonRecord[];
  devicesLoading: boolean;
  devicesError: Error | null;
  reloadDevices: () => void;
}) {
  const { message } = App.useApp();
  const [category, setCategory] = useState<ExportCategory>();
  const [ids, setIds] = useState<string[]>([]);
  const [range, setRange] = useState<[Dayjs, Dayjs] | null>(recentRange);
  const [format, setFormat] = useState<OpsExportOptions["format"]>(device?.device_type === "gateway_node" ? "telemetry_excel" : device?.device_type === "camera" ? "media_zip" : "zip");
  const [includeData, setIncludeData] = useState(true);
  const [includeStatus, setIncludeStatus] = useState(false);
  const [includeImages, setIncludeImages] = useState(device?.source_family !== "lorawan_v2");
  const [phase, setPhase] = useState("all");
  const [nodeScope, setNodeScope] = useState<"bound" | "history">("bound");
  const [nodeSelections, setNodeSelections] = useState<Record<string, string[]>>({});
  const [carbonSelections, setCarbonSelections] = useState<Record<string, number[]>>({});
  const [fieldSelections, setFieldSelections] = useState<Record<string, string[]>>({});
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);

  const { candidatesById, deviceOptions } = useMemo(() => {
    const candidates = device || !category ? [] : devices.filter(item => matchesAdminDeviceCategory(item, category, String(item.topology_role || item.device_type)));
    return {
      candidatesById: new Map(candidates.map(item => [deviceId(item), item])),
      deviceOptions: candidates.map(item => ({ value: deviceId(item), label: exportDeviceLabel(item) })),
    };
  }, [category, device, devices]);
  const selected = device ? [device] : ids.flatMap(id => {
    const item = candidatesById.get(id);
    return item ? [item] : [];
  });
  const kind = device ? String(device.device_type) : category;
  const lora = device ? device.source_family === "lorawan_v2" : category === "lorawan_v2";
  const carbon = kind === "carbon_sink";
  const gateway = kind === "gateway" || kind === "lorawan_v2";
  const combined = kind === "standalone" && format === "zip";
  const taskCount = combined && selected.length ? 1 : selected.length;
  const gatewayTargets = useQueries({ queries: open && gateway && format === "zip" ? selected.map(item => ({
    queryKey: ["admin", "device", deviceId(item), "nodes", "exports", nodeScope],
    queryFn: () => api.admin.deviceNodes(deviceId(item), nodeScope),
  })) : [] });
  const carbonTargets = useQueries({ queries: open && carbon ? selected.map(item => ({
    queryKey: ["admin", "device", deviceId(item), "carbon-overview"],
    queryFn: () => api.admin.carbonOverview(deviceId(item)),
  })) : [] });
  const targetsUnavailable = [...gatewayTargets, ...carbonTargets].some(result => !result.isSuccess);

  function changeCategory(next: ExportCategory) {
    setCategory(next);
    setIds([]);
    setErrors([]);
    setNodeScope("bound");
    setNodeSelections({});
    setCarbonSelections({});
    setFieldSelections({});
    setIncludeData(true);
    setIncludeStatus(false);
    setIncludeImages(next !== "lorawan_v2");
    setFormat(next === "gateway_node" ? "telemetry_excel" : next === "camera" ? "media_zip" : "zip");
  }

  async function create() {
    if (!range || !selected.length || targetsUnavailable) return;
    setErrors([]);
    setBusy(true);
    try {
      const requests = (combined ? selected.slice(0, 1) : selected).map((item, index) => {
        const id = deviceId(item);
        const nodes = gatewayTargets[index]?.data?.items ?? [];
        const chosen = nodeSelections[id];
        const carbonNodes = carbonTargets[index]?.data?.nodes.map(node => Number(node.node_id)) ?? [];
        try {
          const payload = operationsExportPayload(item, {
            start: range[0].toISOString(), end: range[1].toISOString(), format,
            data: includeData, images: includeImages, status: includeStatus,
            nodes: chosen ? nodes.filter(node => chosen.includes(node.key)) : nodes,
            carbonNodes: carbonSelections[id] ?? carbonNodes,
            fields: fieldSelections[id] ?? carbonFields,
            deviceIds: combined ? selected.map(deviceId) : undefined,
          });
          return { item, payload: { ...payload, request_config: { ...payload.request_config, data_phase: phase } } };
        } catch (err) {
          throw new Error(combined ? formatApiError(err).message : `${exportDeviceLabel(item)}：${formatApiError(err).message}`);
        }
      });
      const failed: { id: string; error: string }[] = [];
      for (const { item, payload } of requests) {
        try {
          await api.admin.createExport(payload);
        } catch (err) {
          const description = formatApiError(err).message;
          failed.push({ id: deviceId(item), error: combined ? description : `${exportDeviceLabel(item)}：${description}` });
        }
      }
      const created = requests.length - failed.length;
      if (created) onCreated();
      if (!failed.length) {
        void message.success(`已创建 ${created} 个导出任务`);
        if (!device) setIds([]);
        onClose();
      } else {
        if (created) setIds(failed.map(item => item.id));
        setErrors([...(created ? [`已创建 ${created} 个任务，下方只保留未创建的设备。`] : []), ...failed.map(item => item.error)]);
      }
    } catch (err) {
      setErrors([formatApiError(err).message]);
    } finally {
      setBusy(false);
    }
  }

  return <Modal title="新建后台导出" open={open} width={720} onCancel={() => {
    if (!busy) { setErrors([]); onClose(); }
  }} onOk={() => void create()} confirmLoading={busy} okText={taskCount > 1 ? `创建 ${taskCount} 个任务` : "创建任务"}
    okButtonProps={{ disabled: !selected.length || !range || targetsUnavailable }} destroyOnHidden styles={{ body: { maxHeight: "70vh", overflowY: "auto" } }}>
    <Form layout="vertical" disabled={busy}>
      <Alert type="info" title="后台任务仅管理员可见" style={{ marginBottom: 16 }} />
      {errors.length > 0 && <Alert type="error" title="未能创建全部导出任务" description={<ul style={{ margin: 0, paddingInlineStart: 20 }}>{errors.map((error, index) => <li key={index}>{error}</li>)}</ul>} style={{ marginBottom: 16 }} />}
      {device ? <Form.Item label="设备">{exportDeviceLabel(device)}</Form.Item> : <>
        {devicesError && <Alert type="error" title="设备列表加载失败" description={formatApiError(devicesError).message} action={<Button size="small" onClick={reloadDevices}>重试</Button>} style={{ marginBottom: 16 }} />}
        <Flex align="start" gap={12} wrap>
          <Form.Item label="设备分类" required style={{ width: 160 }}>
            <Select value={category} onChange={changeCategory} placeholder="请选择分类" options={exportCategories.map(({ key, label }) => ({ value: key, label }))} />
          </Form.Item>
          <Form.Item label={selected.length ? `设备（已选 ${selected.length} 台）` : "设备"} required style={{ flex: 1, minWidth: 230 }}>
            <Select mode="multiple" allowClear maxTagCount="responsive" loading={devicesLoading} disabled={!category || devicesLoading}
              showSearch={{ optionFilterProp: "label" }} value={ids} onChange={value => { setIds(value); setErrors([]); }}
              placeholder={category ? "搜索设备名称或资产编号，可多选" : "请先选择设备分类"} notFoundContent="没有匹配的设备"
              options={deviceOptions} />
          </Form.Item>
        </Flex>
      </>}
      <Form.Item label="时间范围（北京时间）" required><AdminTimeRange value={range} onChange={setRange} style={{ width: "100%" }} presets={[{ label: "最近 6 小时", value: [dayjs().subtract(6, "hour"), dayjs()] }, { label: "最近 3 天", value: [dayjs().subtract(3, "day"), dayjs()] }, { label: "最近 7 天", value: recentRange() }]} /></Form.Item>
      <Form.Item label="数据阶段"><Select value={phase} onChange={setPhase} options={[{ value: "all", label: "全部数据" }, { value: "formal", label: "正式观测数据" }, { value: "testing", label: "调试数据" }]} /></Form.Item>
      {kind && !carbon && <Form.Item label="文件类型"><Radio.Group value={format} onChange={event => setFormat(event.target.value)} options={[
        ...(kind === "standalone" || gateway ? [{ value: "zip", label: lora ? "设备数据 / 运行状态 ZIP" : "设备数据 / 图片 ZIP" }] : []),
        { value: "telemetry_excel", label: "采集指标 Excel" }, { value: "telemetry_csv", label: "采集指标 CSV" },
        ...(!lora ? [{ value: "media_zip", label: "图片 ZIP" }] : []),
      ]} /></Form.Item>}
      {lora && format === "zip" && <Form.Item label="节点范围"><Select value={nodeScope} onChange={scope => { setNodeScope(scope); setNodeSelections({}); }} options={[{ value: "bound", label: "当前节点" }, { value: "history", label: "历史数据" }]} /></Form.Item>}
      {selected.map((item, index) => {
        const id = deviceId(item);
        const target = gatewayTargets[index] ?? carbonTargets[index];
        if (!target) return null;
        const label = selected.length > 1 ? `${exportDeviceLabel(item)} · 节点` : "节点";
        if (target.error) return <Form.Item key={id} label={label}><Alert type="error" title="节点加载失败" description={formatApiError(target.error).message} action={<Button size="small" onClick={() => void target.refetch()}>重试</Button>} /></Form.Item>;
        if (gateway) {
          const options = (gatewayTargets[index]?.data?.items ?? []).map(node => ({ value: node.key, label: nodeOptionLabel(node) }));
          return <Form.Item key={id} label={<Space>{label}<Button type="link" size="small" disabled={!options.length} onClick={() => setNodeSelections(previous => ({ ...previous, [id]: options.map(option => option.value) }))}>全选</Button></Space>} required={includeData || !includeStatus}>
            <Select mode="multiple" allowClear maxTagCount="responsive" showSearch={{ optionFilterProp: "label" }} loading={target.isFetching} disabled={target.isPending}
              placeholder="选择导出节点" notFoundContent="当前范围内没有节点" options={options} value={nodeSelections[id] ?? options.map(option => option.value)}
              onChange={value => setNodeSelections(previous => ({ ...previous, [id]: value }))} />
          </Form.Item>;
        }
        const options = (carbonTargets[index]?.data?.nodes ?? []).map(node => ({ value: Number(node.node_id), label: node.name || `Node ${node.node_id}` }));
        return <div key={id}>
          <Form.Item label={label} required>
            <Select mode="multiple" allowClear maxTagCount="responsive" showSearch={{ optionFilterProp: "label" }} loading={target.isFetching} disabled={target.isPending}
              placeholder="选择导出节点" notFoundContent="该设备没有节点" options={options} value={carbonSelections[id] ?? options.map(option => option.value)}
              onChange={value => setCarbonSelections(previous => ({ ...previous, [id]: value }))} />
          </Form.Item>
          <Form.Item label="地块" required><Checkbox.Group value={fieldSelections[id] ?? carbonFields}
            onChange={value => setFieldSelections(previous => ({ ...previous, [id]: value }))} options={carbonFields} /></Form.Item>
        </div>;
      })}
      {kind && (format === "zip" || carbon) && <Form.Item label="打包内容" required><Space wrap>
        <Checkbox checked={includeData} onChange={event => setIncludeData(event.target.checked)}>{carbon ? "通量数据" : "设备数据"}</Checkbox>
        {!lora && <Checkbox checked={includeImages} onChange={event => setIncludeImages(event.target.checked)}>{carbon ? "原始采样" : "采集图片"}</Checkbox>}
        {lora && <Checkbox checked={includeStatus} onChange={event => setIncludeStatus(event.target.checked)}>运行状态</Checkbox>}
      </Space></Form.Item>}
      {selected.length > 1 && <Typography.Text type="secondary">{combined ? `将 ${selected.length} 台设备打包到一个 ZIP 任务` : `按设备分别创建 ${taskCount} 个任务`}</Typography.Text>}
    </Form>
  </Modal>;
}
