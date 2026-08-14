import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import type { FormInstance } from "antd";
import { Activity, Battery, Copy, FileJson, GitBranch, Pencil, Printer, Radio, RefreshCw, Search, Settings2, Trash2 } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import {
  Alert,
  Button,
  Descriptions,
  Drawer,
  Empty,
  Form,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Select,
  Space,
  Table,
  Tag,
  Tabs,
} from "@thcpn/admin-ui";
import {
  api,
  deviceLifecycleLabel,
  deviceLifecycleOptions,
  deviceStatusLabel,
  deviceStatusOptions,
  deviceTopologyRoleLabel,
  describeSamplingControl,
  formatApiError,
  type JsonRecord,
} from "@thcpn/api";
import { Badge, PageHeader, Panel, StateView } from "@thcpn/ui";
import {
  configFieldsFromDetail,
  parseTHCPNConfig,
  type THCPNConfigFields,
} from "./thcpn-config";
import { THCPNVisualConfigEditor } from "./thcpn-config-editor";
import { configChangeSummary, configDraftFromDetail, duplicateSensorWarnings, parseAdvancedConfig, validateVisualConfig } from "./thcpn-config-model";
import { DeviceLogsPanel } from "./device-logs-panel";

type Mode =
  | "edit"
  | "assign"
  | "child"
  | "lifecycle"
  | "capabilities"
  | "attributes"
  | "config"
  | "calibration"
  | "firmware"
  | "camera"
  | "camera-edit"
  | null;
const value = (input: unknown, fallback: unknown = "—"): string =>
  input === undefined || input === null || input === ""
    ? String(fallback)
    : String(input);
const categoryOf = (item: JsonRecord) =>
  value(item.topology_role || item.device_type, "standalone");

export function AdminDevicesPage() {
  const { deviceId } = useParams();
  const query = useQuery({
    queryKey: ["admin", "devices"],
    queryFn: api.admin.devices,
  });
  const allRows = query.data?.items ?? [];
  const detailDevice = allRows.find((item) => value(item.id, "") === deviceId);
  const isCarbonDetail = categoryOf(detailDevice ?? {}) === "carbon_sink";
  const detailAttributesQuery = useQuery({
    queryKey: ["admin", "device", deviceId, "attributes"],
    queryFn: () => api.admin.deviceAttributes(deviceId!),
    enabled: Boolean(detailDevice) && !isCarbonDetail,
  });
  const detailChildrenQuery = useQuery({
    queryKey: ["admin", "device", deviceId, "children"],
    queryFn: () => api.admin.deviceChildren(deviceId!),
    enabled: Boolean(detailDevice) && !isCarbonDetail,
  });
  const detailLifecycleQuery = useQuery({
    queryKey: ["admin", "device", deviceId, "lifecycle"],
    queryFn: () => api.admin.lifecycle(deviceId!),
    enabled: Boolean(detailDevice),
  });
  const detailConfigQuery = useQuery({
    queryKey: ["admin", "device", deviceId, "config"],
    queryFn: () => api.admin.deviceConfig(deviceId!),
    enabled: Boolean(detailDevice) && !isCarbonDetail,
  });
  const detailCarbonQuery = useQuery({
    queryKey: ["admin", "device", deviceId, "carbon-overview"],
    queryFn: () => api.admin.carbonOverview(deviceId!),
    enabled: Boolean(detailDevice) && isCarbonDetail,
  });
  const [keyword, setKeyword] = useState("");
  const [status, setStatus] = useState("");
  const [lifecycle, setLifecycle] = useState("");
  const [assignment, setAssignment] = useState("");
  const [category, setCategory] = useState("all");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([]);
  const [selected, setSelected] = useState<JsonRecord | null>(null);
  const [mode, setMode] = useState<Mode>(null);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [detail, setDetail] = useState<unknown>(null);
  const [configConflict, setConfigConflict] = useState(false);
  const [configResult, setConfigResult] = useState<{
    deviceName: string;
    response: JsonRecord;
  } | null>(null);
  const [children, setChildren] = useState<Record<string, JsonRecord[]>>({});
  const [form] = Form.useForm<Record<string, any>>();
  const topLevelRows = useMemo(
    () => allRows.filter((item) => categoryOf(item) !== "gateway_node"),
    [allRows],
  );
  const counts = useMemo(
    () => ({
      all: topLevelRows.length,
      gateway: topLevelRows.filter((item) => categoryOf(item) === "gateway").length,
      camera: topLevelRows.filter((item) => categoryOf(item) === "camera").length,
      carbon_sink: topLevelRows.filter((item) => categoryOf(item) === "carbon_sink").length,
      standalone: topLevelRows.filter((item) => categoryOf(item) === "standalone")
        .length,
    }),
    [topLevelRows],
  );
  const rows = useMemo(
    () =>
      topLevelRows.filter((item) => {
        const searchable =
          `${value(item.name)} ${value(item.serial_no)} ${value(item.id)}`
            .toLowerCase()
            .includes(keyword.toLowerCase());
        return (
          searchable &&
          (!status || item.status === status) &&
          (!lifecycle || item.lifecycle_status === lifecycle) &&
          (!assignment ||
            (assignment === "assigned"
              ? Boolean(item.workspace_id)
              : !item.workspace_id)) &&
          (category === "all" || categoryOf(item) === category)
        );
      }),
    [topLevelRows, keyword, status, lifecycle, assignment, category],
  );
  const id = value(selected?.id, "");

  useEffect(() => {
    setPage(1);
  }, [keyword, status, lifecycle, assignment, category]);

  useEffect(() => {
    const lastPage = Math.max(1, Math.ceil(rows.length / pageSize));
    if (page > lastPage) setPage(lastPage);
  }, [page, pageSize, rows.length]);

  const selectedRows = useMemo(() => {
    const keys = new Set(selectedRowKeys.map(String));
    return topLevelRows.filter((item) => keys.has(value(item.id, "")));
  }, [selectedRowKeys, topLevelRows]);

  const runBatch = async (
    action: "activate" | "disable" | "unassign",
  ) => {
    const candidates =
      action === "unassign"
        ? selectedRows.filter((item) => Boolean(item.workspace_id))
        : selectedRows;
    if (!candidates.length) {
      setFeedback(
        action === "unassign" ? "选中的设备均未分配工作区" : "请先选择设备",
      );
      return;
    }
    const actionLabel =
      action === "activate" ? "启用" : action === "disable" ? "停用" : "解除分配";
    Modal.confirm({
      title: `批量${actionLabel}设备`,
      content: `将处理 ${candidates.length} 台设备。各设备独立提交，单条失败不会中断其他设备。`,
      okText: `确认${actionLabel}`,
      cancelText: "取消",
      okButtonProps: { danger: action !== "activate" },
      onOk: async () => {
        setBusy(true);
        setFeedback("");
        try {
          const results = await Promise.allSettled(
            candidates.map((item) => {
              const deviceID = value(item.id, "");
              return action === "unassign"
                ? api.admin.unassignDevice(deviceID)
                : api.admin.updateDevice(deviceID, {
                    status: action === "activate" ? "active" : "disabled",
                  });
            }),
          );
          const failedKeys = results.flatMap((result, index) =>
            result.status === "rejected"
              ? [value(candidates[index]?.id, "")]
              : [],
          );
          const succeeded = results.length - failedKeys.length;
          setFeedback(
            failedKeys.length
              ? `批量${actionLabel}完成：成功 ${succeeded} 台，失败 ${failedKeys.length} 台`
              : `已批量${actionLabel} ${succeeded} 台设备`,
          );
          setSelectedRowKeys(failedKeys);
          await query.refetch();
        } finally {
          setBusy(false);
        }
      },
    });
  };

  const open = (next: Exclude<Mode, null>, record: JsonRecord) => {
    setSelected(record);
    setMode(next);
    setDetail(null);
    if (next === "edit")
      form.setFieldsValue({
        product_id: record.product_id,
        serial_no: record.serial_no,
        name: record.name,
        status: record.status,
        device_type: record.device_type,
      });
    if (next === "assign")
      form.setFieldsValue({
        target_workspace_id: record.workspace_id,
        project_id: record.project_id,
        site_id: record.site_id,
      });
    if (next === "calibration")
      form.setFieldsValue({ calibration_type: "zero_point", parameters: "{}" });
    if (next === "firmware")
      form.setFieldsValue({ firmware_version: "", package_uri: "", checksum: "", scheduled_at: "" });
    if (next === "child") {
      form.setFieldsValue({ child_device_id: "" });
      void loadDetail("children", record);
    }
    if (next === "lifecycle") {
      form.setFieldsValue({
        lifecycle_status: record.lifecycle_status,
        note: "",
      });
      void loadDetail("lifecycle", record);
    }
    if (next === "capabilities")
      form.setFieldsValue({ capabilities: record.capabilities ?? [] });
    if (next === "attributes") void loadDetail("attributes", record);
    if (next === "config") {
      form.setFieldsValue({
        data_json: "[]",
        image_json: "[]",
        control_json: "{}",
        expected_config_id: 0,
      });
      setConfigConflict(false);
      void loadDetail("config", record);
    }
    if (next === "camera")
      form.setFieldsValue({
        name: record.name,
        serial_no: `${value(record.serial_no, "camera")}-camera`,
        device_serial: "",
        channel_no: 1,
        default_quality: "standard",
        is_encrypted: false,
        validate_code_secret_ref: "",
        target_workspace_id: record.workspace_id,
        project_id: record.project_id,
        site_id: record.site_id,
      });
    if (next === "camera-edit") {
      form.setFieldsValue({});
      void api.admin
        .camera(value(record.id, ""))
        .then((camera) => {
          const binding = camera.binding as JsonRecord;
          form.setFieldsValue({
            device_serial: binding?.device_serial,
            channel_no: binding?.channel_no,
            default_quality: binding?.default_quality,
            is_encrypted: binding?.is_encrypted,
            validate_code_secret_ref: binding?.validate_code_secret_ref,
            status: binding?.status,
          });
        })
        .catch(showError);
    }
  };
  const openCameraCreate = () => {
    setSelected(null);
    setMode("camera");
    setDetail(null);
    form.setFieldsValue({ name: "", serial_no: "", device_serial: "", channel_no: 1, default_quality: "standard", is_encrypted: false, validate_code_secret_ref: "", target_workspace_id: undefined, project_id: undefined, site_id: undefined });
  };
  const close = () => {
    setMode(null);
    setDetail(null);
    form.resetFields();
  };
  const loadDetail = async (
    kind: "children" | "lifecycle" | "capabilities" | "config" | "attributes",
    record = selected,
  ) => {
    if (!record) return;
    setSelected(record);
    setBusy(true);
    setFeedback("");
    try {
      const deviceId = value(record.id, "");
      const response =
        kind === "children"
          ? await api.admin.deviceChildren(deviceId)
          : kind === "lifecycle"
            ? await api.admin.lifecycle(deviceId)
            : kind === "capabilities"
              ? await api.admin.capabilities(deviceId)
              : kind === "config"
                ? await api.admin.deviceConfig(deviceId)
                : await api.admin.deviceAttributes(deviceId);
      setDetail(response);
      if (kind === "config")
        form.setFieldsValue(configFieldsFromDetail(response));
    } catch (error) {
      showError(error);
    } finally {
      setBusy(false);
    }
  };
  const showError = (error: unknown) => {
    const item = formatApiError(error);
    setFeedback(
      `${item.message}${item.requestId ? ` · request id ${item.requestId}` : ""}`,
    );
  };
  const submit = async () => {
    setBusy(true);
    setFeedback("");
    try {
      const fields = await form.validateFields();
      if (!selected && mode !== "camera") throw new Error("请先选择设备");
      if (mode === "edit") await api.admin.updateDevice(id, fields);
      if (mode === "assign") await api.admin.assignDevice(id, fields);
      if (mode === "calibration")
        await api.admin.calibrateDevice(id, {
          calibration_type: fields.calibration_type,
          ...(fields.parameters?.trim() && fields.parameters.trim() !== "{}"
            ? { parameters: JSON.parse(fields.parameters) }
            : {}),
        });
      if (mode === "firmware")
        await api.admin.upgradeDeviceFirmware(id, {
          firmware_version: fields.firmware_version.trim(),
          ...(fields.package_uri?.trim() ? { package_uri: fields.package_uri.trim() } : {}),
          ...(fields.checksum?.trim() ? { checksum: fields.checksum.trim() } : {}),
          ...(fields.scheduled_at ? { scheduled_at: new Date(fields.scheduled_at).toISOString() } : {}),
        });
      if (mode === "child") await api.admin.addDeviceChild(id, fields);
      if (mode === "lifecycle") await api.admin.updateLifecycle(id, fields);
      if (mode === "capabilities")
        await api.admin.updateCapabilities(id, {
          capabilities: fields.capabilities ?? [],
        });
      if (mode === "config") {
        const payload = parseTHCPNConfig(fields as THCPNConfigFields);
        const after = parseAdvancedConfig({ data: fields.data_json, image: fields.image_json, control: fields.control_json }, fields.expected_config_id);
        const validation = validateVisualConfig(after);
        if (validation.length) throw new Error(validation.join("；"));
        const before = configDraftFromDetail((detail ?? {}) as JsonRecord);
        const summary = configChangeSummary(before, after);
        const warnings = duplicateSensorWarnings(after.sensors);
        const confirmed = await confirmConfigSave(summary, warnings);
        if (!confirmed) { setBusy(false); return; }
        const response = await api.admin.updateDeviceConfig(id, payload);
        setConfigResult({ deviceName: value(selected?.name, id), response });
      }
      if (mode === "camera") await api.admin.createCamera(fields);
      if (mode === "camera-edit") await api.admin.updateCamera(id, fields);
      if (mode === "child")
        setChildren((current) => {
          const next = { ...current };
          delete next[id];
          return next;
        });
      const completedMode = mode;
      setFeedback("操作已完成");
      close();
      await query.refetch();
      if (completedMode === "config") await detailConfigQuery.refetch();
    } catch (error) {
      if (!(error as any)?.errorFields) {
        const formatted = formatApiError(error);
        if (mode === "config" && formatted.status === 409) {
          setConfigConflict(true);
          setFeedback("源数据库配置已被其他操作更新。当前草稿已保留，请复制草稿后重新加载最新配置。");
        } else showError(error);
      }
    } finally {
      setBusy(false);
    }
  };
  const unassign = async (record: JsonRecord) => {
    setBusy(true);
    setFeedback("");
    try {
      await api.admin.unassignDevice(value(record.id, ""));
      setFeedback("设备分配已解除");
      await query.refetch();
    } catch (error) {
      showError(error);
    } finally {
      setBusy(false);
    }
  };
  const loadChildren = async (record: JsonRecord) => {
    const deviceId = value(record.id, "");
    if (children[deviceId]) return;
    try {
      const response = await api.admin.deviceChildren(deviceId);
      setChildren((current) => ({ ...current, [deviceId]: response.items }));
    } catch (error) {
      showError(error);
    }
  };
  const removeChild = async (parentId: string, childId: string) => {
    try {
      await api.admin.removeDeviceChild(parentId, childId);
      const withoutChild = (items: JsonRecord[]) =>
        items.filter(
          (item) => value(((item.device ?? item) as JsonRecord).id) !== childId,
        );
      setChildren((current) => ({
        ...current,
        [parentId]: withoutChild(current[parentId] ?? []),
      }));
      setDetail((current: unknown) =>
        current &&
        typeof current === "object" &&
        Array.isArray((current as JsonRecord).items)
          ? {
              ...(current as JsonRecord),
              items: withoutChild(
                (current as JsonRecord).items as JsonRecord[],
              ),
            }
          : current,
      );
      setFeedback("拓扑关系已移除");
      await query.refetch();
    } catch (error) {
      showError(error);
    }
  };

  const managementOverlays = (
    <>
      {configResult ? <ConfigApplyResult result={configResult} onClose={() => setConfigResult(null)} /> : null}
      <Drawer title={drawerTitle(mode, selected)} open={Boolean(mode)} onClose={close} size={mode === "config" ? 1180 : 620} extra={mode === "attributes" ? <Button onClick={close}>关闭</Button> : <Space><Button onClick={close}>取消</Button><Button type="primary" danger={mode === "config"} loading={busy} onClick={() => void submit()}>保存</Button></Space>}>
        {mode === "config" && configConflict ? <Alert className="config-conflict-alert" type="warning" showIcon title="源配置已变化，当前草稿尚未保存" description="复制草稿后重新加载最新配置；系统不会强制覆盖其他操作写入的版本。" action={<Space orientation="vertical"><Button size="small" onClick={() => void navigator.clipboard.writeText(JSON.stringify(parseTHCPNConfig(form.getFieldsValue() as THCPNConfigFields), null, 2))}>复制草稿</Button><Button size="small" type="primary" onClick={() => { setConfigConflict(false); void loadDetail("config", selected); }}>重新加载</Button></Space>} /> : null}
        <Form form={form} layout="vertical"><DeviceForm mode={mode} form={form} devices={allRows} deviceId={id} /></Form>
        <StructuredDetail mode={mode} detail={detail} busy={busy} onRemove={(childId) => selected && void removeChild(value(selected.id, ""), childId)} />
        {mode === "config" && detail ? <ConfigContext detail={detail as JsonRecord} /> : null}
        <div className="drawer-note"><Settings2 size={15} />{mode === "config" ? "高级配置会写入外部设备库，并刷新平台数据流与绑定。提交前请确认 JSON 结构。" : "所有操作都作用于标题中显示的当前设备；完成后设备列表会自动刷新。"}</div>
      </Drawer>
    </>
  );

  if (deviceId) {
    const device = allRows.find((item) => value(item.id, "") === deviceId);
    if (query.isLoading) return <StateView type="loading" title="正在加载设备详情" description="正在读取系统设备资产。" />;
    if (query.error) return <StateView type="error" title="设备详情加载失败" description={formatApiError(query.error).message} requestId={formatApiError(query.error).requestId} />;
    if (!device) return <StateView type="empty" title="设备不存在" description="该设备可能已被删除或尚未同步。" action={<Button><Link to="/admin/devices">返回设备列表</Link></Button>} />;
    const isCamera = categoryOf(device) === "camera";
    const refreshDetail = () => void Promise.all([query.refetch(), detailLifecycleQuery.refetch(), ...(isCarbonDetail ? [detailCarbonQuery.refetch()] : [detailAttributesQuery.refetch(), detailChildrenQuery.refetch(), detailConfigQuery.refetch()])]);
    return <><PageHeader eyebrow="System / devices / detail" title={value(device.name, "未命名设备")} description={`${value(device.serial_no, device.id)} · ${deviceTopologyRoleLabel(categoryOf(device))}`} actions={<Space><Button><Link to="/admin/devices">返回列表</Link></Button><Button type="primary" icon={<Pencil size={14} />} onClick={() => open("edit", device)}>编辑资料</Button><Button icon={<RefreshCw size={14} />} onClick={refreshDetail}>刷新</Button></Space>} />{feedback && <div className="admin-feedback section-gap">{feedback}</div>}<DeviceDetailPanel device={device} isCamera={isCamera} isCarbon={isCarbonDetail} carbonData={detailCarbonQuery.data as unknown as JsonRecord | undefined} carbonLoading={detailCarbonQuery.isLoading} carbonError={detailCarbonQuery.error} attributes={detailAttributesQuery.data as unknown as JsonRecord | undefined} attributesLoading={detailAttributesQuery.isLoading} attributesError={detailAttributesQuery.error} childrenData={detailChildrenQuery.data as unknown as JsonRecord | undefined} childrenLoading={detailChildrenQuery.isLoading} childrenError={detailChildrenQuery.error} lifecycleData={detailLifecycleQuery.data as JsonRecord | undefined} lifecycleLoading={detailLifecycleQuery.isLoading} lifecycleError={detailLifecycleQuery.error} configData={detailConfigQuery.data as JsonRecord | undefined} configLoading={detailConfigQuery.isLoading} configError={detailConfigQuery.error} onOpen={(next) => open(next, device)} onUnassign={() => void unassign(device)} />{managementOverlays}</>;
  }

  return (
    <>
      <PageHeader
        eyebrow="System / devices"
        title="系统设备"
        description="统一管理标准站、组网站、碳汇站和监控站。"
        actions={<Space><Button type="primary" onClick={openCameraCreate}>创建监控站</Button><Button icon={<RefreshCw size={14} />} onClick={() => void query.refetch()}>刷新</Button></Space>}
      />
      <Panel>
        <div className="admin-device-filters">
          <div className="admin-search">
            <Search size={15} />
            <input
              value={keyword}
              onChange={(event) => setKeyword(event.target.value)}
              placeholder="搜索设备名称、序列号或 ID"
            />
          </div>
          <Select
            allowClear
            placeholder="资产状态"
            value={status || undefined}
            onChange={(item) => setStatus(item ?? "")}
            options={deviceStatusOptions.map((item) => ({ value: item.value, label: deviceStatusLabel(item.value) }))}
          />
          <Select
            allowClear
            placeholder="生命周期"
            value={lifecycle || undefined}
            onChange={(item) => setLifecycle(item ?? "")}
            options={deviceLifecycleOptions.map((item) => ({ value: item.value, label: deviceLifecycleLabel(item.value) }))}
          />
          <Select
            allowClear
            placeholder="分配状态"
            value={assignment || undefined}
            onChange={(item) => setAssignment(item ?? "")}
            options={[
              { value: "assigned", label: "已分配" },
              { value: "unassigned", label: "未分配" },
            ]}
          />
          <Badge tone="info">{rows.length} 台设备</Badge>
        </div>
        <div className="admin-device-categories">
          {[
            { key: "all", label: "全部" },
            { key: "standalone", label: "标准站" },
            { key: "gateway", label: "组网站" },
            { key: "carbon_sink", label: "碳汇站" },
            { key: "camera", label: "监控站" },
          ].map((item) => (
            <button
              key={item.key}
              className={category === item.key ? "active" : ""}
              onClick={() => setCategory(item.key)}
            >
              {item.label}
              <strong>{counts[item.key as keyof typeof counts]}</strong>
            </button>
          ))}
        </div>
        {selectedRowKeys.length ? (
          <div className="admin-device-batch-toolbar">
            <strong>已选择 {selectedRowKeys.length} 台</strong>
            <Space wrap>
              <Button loading={busy} onClick={() => void runBatch("activate")}>批量启用</Button>
              <Button danger loading={busy} onClick={() => void runBatch("disable")}>批量停用</Button>
              <Button loading={busy} onClick={() => void runBatch("unassign")}>解除分配</Button>
              <Button type="text" disabled={busy} onClick={() => setSelectedRowKeys([])}>清空选择</Button>
            </Space>
          </div>
        ) : null}
        {feedback && <div className="admin-feedback">{feedback}</div>}
        {query.isLoading ? (
          <StateView
            type="loading"
            title="正在加载设备"
            description="正在读取系统设备资产。"
          />
        ) : query.error ? (
          <StateView
            type="error"
            title="设备加载失败"
            description={formatApiError(query.error).message}
            requestId={formatApiError(query.error).requestId}
          />
        ) : rows.length ? (
          <Table
            rowKey="id"
            dataSource={rows}
            rowSelection={{
              selectedRowKeys,
              preserveSelectedRowKeys: true,
              onChange: setSelectedRowKeys,
            }}
            rowClassName={(record) =>
              record.id === selected?.id ? "admin-selected-row" : ""
            }
            columns={columns()}
            expandable={{
              rowExpandable: (record) => categoryOf(record) === "gateway",
              onExpand: (expanded, record) =>
                expanded && void loadChildren(record),
              expandedRowRender: (record) => (
                <ChildList
                  items={children[value(record.id, "")] ?? []}
                  loading={!children[value(record.id, "")]}
                  onRemove={(childId) =>
                    void removeChild(value(record.id, ""), childId)
                  }
                />
              ),
            }}
            pagination={{
              current: page,
              pageSize,
              total: rows.length,
              showSizeChanger: true,
              showQuickJumper: true,
              pageSizeOptions: [20, 50, 100],
              showTotal: (total, range) => `${range[0]}-${range[1]} / 共 ${total} 台`,
              onChange: (nextPage, nextPageSize) => {
                setPageSize(nextPageSize);
                setPage(nextPageSize !== pageSize ? 1 : nextPage);
              },
            }}
            scroll={{ x: 1080 }}
          />
        ) : (
          <StateView
            type="empty"
            title="没有匹配的设备"
            description={
              keyword || status || lifecycle || assignment || category !== "all"
                ? "请调整搜索或筛选条件。"
                : "请先从数据源同步设备资产。"
            }
          />
        )}
      </Panel>
      {managementOverlays}
    </>
  );
}

type DetailQueryProps = {
  data?: JsonRecord;
  loading: boolean;
  error: unknown;
};

function confirmConfigSave(summary: ReturnType<typeof configChangeSummary>, warnings: string[]) {
  const changes = [
    summary.sensorsAdded ? `新增 ${summary.sensorsAdded} 个传感器` : "",
    summary.sensorsRemoved ? `删除 ${summary.sensorsRemoved} 个传感器` : "",
    summary.metricsChanged ? (summary.metricsBefore !== summary.metricsAfter ? `指标 ${summary.metricsBefore} → ${summary.metricsAfter}` : "指标定义已修改") : "",
    summary.imagesAdded ? `新增 ${summary.imagesAdded} 个图片通道` : "",
    summary.imagesRemoved ? `删除 ${summary.imagesRemoved} 个图片通道` : "",
    summary.controlChanged ? "控制策略已修改" : "",
  ].filter(Boolean);
  return new Promise<boolean>((resolve) => {
    let settled = false;
    const finish = (value: boolean) => { if (!settled) { settled = true; resolve(value); } };
    Modal.confirm({
      title: "保存并下发设备配置？",
      width: 560,
      okText: "保存并下发",
      cancelText: "继续编辑",
      okButtonProps: { danger: summary.sensorsRemoved > 0 || summary.imagesRemoved > 0 },
      content: <div className="config-save-summary"><p>{changes.length ? changes.join("；") : "配置内容已修改"}</p>{warnings.length ? <Alert type="warning" showIcon title="共享总线存在重复命令" description={warnings.join("；")} /> : null}<p>系统会写入 THCPN 外部设备库，并同步 DataStream 与 Binding。</p></div>,
      onOk: () => finish(true),
      onCancel: () => finish(false),
      afterClose: () => finish(false),
    });
  });
}

function DeviceDetailPanel({
  device,
  isCamera,
  isCarbon,
  carbonData,
  carbonLoading,
  carbonError,
  attributes,
  attributesLoading,
  attributesError,
  childrenData,
  childrenLoading,
  childrenError,
  lifecycleData,
  lifecycleLoading,
  lifecycleError,
  configData,
  configLoading,
  configError,
  onOpen,
  onUnassign,
}: {
  device: JsonRecord;
  isCamera: boolean;
  isCarbon: boolean;
  carbonData?: JsonRecord;
  carbonLoading: boolean;
  carbonError: unknown;
  attributes?: JsonRecord;
  attributesLoading: boolean;
  attributesError: unknown;
  childrenData?: JsonRecord;
  childrenLoading: boolean;
  childrenError: unknown;
  lifecycleData?: JsonRecord;
  lifecycleLoading: boolean;
  lifecycleError: unknown;
  configData?: JsonRecord;
  configLoading: boolean;
  configError: unknown;
  onOpen: (mode: Exclude<Mode, null>) => void;
  onUnassign: () => void;
}) {
  const children = (childrenData?.items as JsonRecord[] | undefined) ?? [];
  const events = (lifecycleData?.events as JsonRecord[] | undefined) ?? [];
  const capabilities = Array.isArray(device.capabilities) ? device.capabilities.map(String) : [];
  const latestConfig = (configData?.latest_config ?? {}) as JsonRecord;
  const snapshot = (configData?.latest_snapshot ?? {}) as JsonRecord;
  const attributeItems = Object.entries((attributes?.attributes ?? {}) as JsonRecord);
  const sourceDevice = (attributes?.source_device ?? {}) as JsonRecord;
  const carbonRuntime = (carbonData?.runtime ?? {}) as JsonRecord;
  const carbonNodes = (carbonData?.nodes as JsonRecord[] | undefined) ?? [];
  const date = (input: unknown) => input ? new Intl.DateTimeFormat(document.documentElement.lang || "zh-CN", { dateStyle: "medium", timeStyle: "short" }).format(new Date(String(input))) : "—";
  const inlineError = (error: unknown, title: string) => error ? <Alert type="warning" showIcon title={title} description={formatApiError(error).message} /> : null;
  const queryLoading = ({ loading, data, error }: DetailQueryProps) => loading && !data && !error;
  const overview = <div className="admin-device-detail-content">
    <section className="admin-detail-section">
      <div className="admin-detail-section-head"><div><h2>设备资料</h2><span>系统设备的身份与资产状态</span></div><Button icon={<Pencil size={14} />} onClick={() => onOpen("edit")}>编辑</Button></div>
      <Descriptions bordered size="small" column={{ xs: 1, sm: 2, lg: 3 }} items={[
        { key: "serial", label: "序列号", children: <span className="mono">{value(device.serial_no)}</span> },
        { key: "product", label: "产品 ID", children: value(device.product_id) },
        { key: "type", label: "设备类型", children: deviceTopologyRoleLabel(value(device.device_type, "")) },
        { key: "id", label: "设备 ID", span: 2, children: <span className="mono admin-break-value">{value(device.id)}</span> },
        { key: "status", label: "资产状态", children: <Tag color={device.status === "active" ? "green" : "default"}>{deviceStatusLabel(value(device.status, ""))}</Tag> },
        { key: "created", label: "创建时间", children: date(device.created_at) },
        { key: "updated", label: "更新时间", children: date(device.updated_at) },
        { key: "activated", label: "激活时间", children: date(device.activated_at) },
      ]} />
    </section>
    {(device.device_type === "gateway" || device.device_type === "standalone" || device.device_type === "carbon_sink") ? <ClaimCredentialSection device={device} date={date} /> : null}
    <section className="admin-detail-section">
      <div className="admin-detail-section-head"><div><h2>分配关系</h2><span>设备当前所属的工作区与资源位置</span></div><Space><Button onClick={() => onOpen("assign")}>调整分配</Button>{Boolean(device.workspace_id) && <Popconfirm title="解除工作区分配？" description="设备将不再对该工作区可见。" onConfirm={onUnassign}><Button danger>解除分配</Button></Popconfirm>}</Space></div>
      <Descriptions bordered size="small" column={{ xs: 1, sm: 2, lg: 3 }} items={[
        { key: "workspace", label: "工作区", children: device.workspace_id ? <span className="mono admin-break-value">{value(device.workspace_id)}</span> : <Tag>未分配</Tag> },
        { key: "project", label: "项目", children: value(device.project_id, "未设置") },
        { key: "site", label: "样地", children: value(device.site_id, "未设置") },
        { key: "assigned", label: "分配时间", children: date(device.assigned_at) },
        { key: "assignedBy", label: "分配人", span: 2, children: value(device.assigned_by) },
      ]} />
    </section>
    <section className="admin-detail-section">
      <div className="admin-detail-section-head"><div><h2>生命周期</h2><span>当前阶段与最近一次状态变更</span></div><Button icon={<Activity size={14} />} onClick={() => onOpen("lifecycle")}>更新状态</Button></div>
      {inlineError(lifecycleError, "生命周期历史加载失败")}
      <Descriptions bordered size="small" column={{ xs: 1, sm: 3 }} items={[
        { key: "lifecycle", label: "当前阶段", children: <Tag color="blue">{deviceLifecycleLabel(value(device.lifecycle_status, ""))}</Tag> },
        { key: "lifecycleAt", label: "状态更新时间", children: date(device.lifecycle_updated_at) },
        { key: "eventCount", label: "历史记录", children: queryLoading({ loading: lifecycleLoading, data: lifecycleData, error: lifecycleError }) ? "加载中…" : `${events.length} 条` },
      ]} />
      {events.length ? <div className="admin-latest-event"><strong>{events[0].from_status ? `${deviceLifecycleLabel(value(events[0].from_status, ""))} → ` : ""}{deviceLifecycleLabel(value(events[0].to_status, ""))}</strong><span>{date(events[0].occurred_at)}{events[0].note ? ` · ${value(events[0].note)}` : ""}</span></div> : null}
    </section>
    {isCamera ? <section className="admin-detail-section"><div className="admin-detail-section-head"><div><h2>监控站视频绑定</h2><span>管理当前监控站的萤石云通道和清晰度</span></div><Button onClick={() => onOpen("camera-edit")}>编辑绑定</Button></div></section> : null}
    <section className="admin-detail-section">
      <div className="admin-detail-section-head">
        <div><h2>设备操作</h2><span>校准、固件升级与工作区转移仅由系统管理员执行</span></div>
        <Space>
          {capabilities.includes("calibratable") ? <Button onClick={() => onOpen("calibration")}>设备校准</Button> : null}
          {capabilities.includes("firmware_update") ? <Button onClick={() => onOpen("firmware")}>固件升级</Button> : null}
          <Button onClick={() => onOpen("assign")}>转移设备</Button>
        </Space>
      </div>
    </section>
  </div>;
  const topology = <div className="admin-device-detail-content">
    <section className="admin-detail-section">
      <div className="admin-detail-section-head"><div><h2>拓扑关系</h2><span>{deviceTopologyRoleLabel(value(device.topology_role, ""))} · {children.length} 个子节点</span></div><Button icon={<GitBranch size={14} />} onClick={() => onOpen("child")}>管理拓扑</Button></div>
      {inlineError(childrenError, "拓扑信息加载失败")}
      {queryLoading({ loading: childrenLoading, data: childrenData, error: childrenError }) ? <div className="admin-inline-loading">正在加载拓扑…</div> : children.length ? <Table rowKey={(item) => value(((item.device ?? item) as JsonRecord).id)} size="small" pagination={false} dataSource={children} columns={[
        { title: "节点", render: (_, item) => { const child = (item.device ?? item) as JsonRecord; return <div><strong>{value(child.name, "未命名节点")}</strong><div className="cell-sub mono">{value(child.serial_no, child.id)}</div></div>; } },
        { title: "状态", width: 110, render: (_, item) => { const child = (item.device ?? item) as JsonRecord; return <Tag color={child.status === "active" ? "green" : "default"}>{deviceStatusLabel(value(child.status, ""))}</Tag>; } },
        { title: "分配", width: 110, render: (_, item) => { const child = (item.device ?? item) as JsonRecord; return child.workspace_id ? <Tag color="blue">已分配</Tag> : <Tag>未分配</Tag>; } },
      ]} /> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="当前设备没有子节点" />}
    </section>
    <section className="admin-detail-section">
      <div className="admin-detail-section-head"><div><h2>设备能力</h2><span>能力决定平台可提供的数据与控制功能</span></div><Button onClick={() => onOpen("capabilities")}>编辑能力</Button></div>
      <div className="admin-capability-list">{capabilities.length ? capabilities.map((capability) => <Tag key={capability} color="blue">{capability}</Tag>) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="尚未配置设备能力" />}</div>
    </section>
  </div>;
  const configuration = <div className="admin-device-detail-content">
    <section className="admin-detail-section">
      <div className="admin-detail-section-head"><div><h2>THCPN 配置</h2><span>源库最新配置与平台同步快照</span></div><Button type="primary" icon={<FileJson size={14} />} onClick={() => onOpen("config")}>编辑完整配置</Button></div>
      {inlineError(configError, "设备配置加载失败")}
      {queryLoading({ loading: configLoading, data: configData, error: configError }) ? <div className="admin-inline-loading">正在加载配置…</div> : configData ? <><Descriptions bordered size="small" column={{ xs: 1, sm: 2, lg: 4 }} items={[
        { key: "external", label: "外部设备 ID", children: value(configData.external_device_id) },
        { key: "version", label: "配置版本", children: value(latestConfig.version, latestConfig.id) },
        { key: "sourceTime", label: "源库更新时间", children: date(latestConfig.updated_at ?? latestConfig.created_at) },
        { key: "syncTime", label: "平台同步时间", children: date(snapshot.synced_at) },
        { key: "dataCount", label: "数据指标", children: `${Array.isArray(latestConfig.data_json) ? latestConfig.data_json.length : 0} 项` },
        { key: "imageCount", label: "图片类型", children: `${Array.isArray(latestConfig.image_json) ? latestConfig.image_json.length : 0} 项` },
        { key: "sampling", label: "采集策略", span: 2, children: describeSamplingControl(latestConfig.control_json) },
      ]} />{latestConfig.id && snapshot.external_config_id && String(latestConfig.id) !== String(snapshot.external_config_id) ? <Alert className="admin-config-warning" type="warning" showIcon title="源配置与平台快照不一致" description="源数据库配置已变化，平台数据流和绑定可能尚未同步。" /> : null}</> : null}
    </section>
    <section className="admin-detail-section">
      <div className="admin-detail-section-head"><div><h2>源设备实时状态</h2><span>直接读取 THCPN devices 表，不写入平台业务库</span></div></div>
      {inlineError(attributesError, "源设备状态加载失败")}
      {queryLoading({ loading: attributesLoading, data: attributes, error: attributesError }) ? <div className="admin-inline-loading">正在读取源设备状态…</div> : Object.keys(sourceDevice).length ? <Descriptions bordered size="small" column={{ xs: 1, sm: 2, lg: 4 }} items={[
        { key: "runtime-status", label: "源运行状态", children: <Tag color={Number(sourceDevice.active) === 0 ? "default" : "green"}>{value(sourceDevice.status, "未知")}{Number(sourceDevice.active) === 0 ? " · 停用" : ""}</Tag> },
        { key: "runtime-version", label: "当前设备版本", children: value(sourceDevice.current_device_version, sourceDevice.version) },
        { key: "runtime-update", label: "源库更新时间", children: date(sourceDevice.updated_at) },
        { key: "runtime-type", label: "源设备类型", children: value(sourceDevice.device_type) },
        { key: "runtime-location", label: "实时经纬度", span: 2, children: sourceDevice.lat !== undefined && sourceDevice.lon !== undefined ? <span className="mono">{Number(sourceDevice.lat).toFixed(6)}, {Number(sourceDevice.lon).toFixed(6)}</span> : "暂无定位" },
        { key: "runtime-altitude", label: "实时海拔", children: sourceDevice.alt !== undefined ? `${Number(sourceDevice.alt).toFixed(1)} m` : "—" },
        { key: "runtime-name", label: "源设备名称", children: value(sourceDevice.name) },
      ]} /> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="源设备不存在或当前不可读取" />}
    </section>
    <section className="admin-detail-section">
      <div className="admin-detail-section-head"><div><h2>最新设备属性</h2><span>来自源数据库的电池、信号和扩展信息</span></div><Button onClick={() => onOpen("attributes")}>查看原始属性</Button></div>
      {inlineError(attributesError, "设备属性加载失败")}
      {queryLoading({ loading: attributesLoading, data: attributes, error: attributesError }) ? <div className="admin-inline-loading">正在加载设备属性…</div> : attributeItems.length ? <div className="admin-attribute-grid">{attributeItems.map(([key, raw]) => { const item = raw as JsonRecord; const parsed = item.parsed_value ?? item.raw_value; const Icon = key === "battery" ? Battery : key === "signal" ? Radio : Settings2; return <div key={key}><Icon size={17} /><span>{key === "battery" ? "电池" : key === "signal" ? "信号" : key}</span><strong>{typeof parsed === "object" ? JSON.stringify(parsed) : value(parsed)}</strong><small>{date(item.sampled_at)}</small></div>; })}</div> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无设备属性" />}
    </section>
  </div>;
  const carbonManagement = <div className="admin-device-detail-content">
    <section className="admin-detail-section">
      <div className="admin-detail-section-head"><div><h2>碳汇数据概览</h2><span>展示源库中当前设备的最新数据，不判断实时在线状态</span></div></div>
      {inlineError(carbonError, "碳汇数据加载失败")}
      {queryLoading({ loading: carbonLoading, data: carbonData, error: carbonError }) ? <div className="admin-inline-loading">正在读取碳汇数据…</div> : carbonData ? <Descriptions bordered size="small" column={{ xs: 1, sm: 2, lg: 4 }} items={[
        { key: "external", label: "源设备 ID", children: value(carbonData.external_device_id) },
        { key: "nodes", label: "节点数量", children: `${value(carbonData.nodes_count, 0)} 个` },
        { key: "sample", label: "最新数据", children: date(carbonData.latest_sample_at) },
        { key: "flux", label: "最新通量", children: date(carbonData.latest_flux_at) },
        { key: "battery", label: "电池", children: value(carbonRuntime.battery) },
        { key: "signal", label: "信号", children: value(carbonRuntime.signal) },
        { key: "network", label: "网络", children: value(carbonRuntime.network) },
        { key: "refreshed", label: "读取时间", children: date(carbonData.refreshed_at) },
      ]} /> : null}
    </section>
    <section className="admin-detail-section">
      <div className="admin-detail-section-head"><div><h2>节点最新数据</h2><span>每个采集节点最后一次写入源库的时间</span></div></div>
      {carbonNodes.length ? <Table rowKey="node_id" size="small" pagination={false} dataSource={carbonNodes} columns={[
        { title: "节点", width: 100, render: (_, item) => `Node ${value(item.node_id)}` },
        { title: "数据状态", width: 120, render: (_, item) => <Tag color={item.status === "has_data" ? "green" : "default"}>{item.status === "has_data" ? "有数据" : "暂无数据"}</Tag> },
        { title: "最新数据", render: (_, item) => date(item.latest_sample_at) },
        { title: "最新通量", render: (_, item) => date(item.latest_flux_at) },
      ]} /> : !carbonLoading && !carbonError ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无节点数据" /> : null}
    </section>
    <section className="admin-detail-section">
      <div className="admin-detail-section-head"><div><h2>设备能力</h2><span>管理碳汇站在平台中可使用的功能</span></div><Button onClick={() => onOpen("capabilities")}>编辑能力</Button></div>
      <div className="admin-capability-list">{capabilities.length ? capabilities.map((capability) => <Tag key={capability} color="blue">{capability}</Tag>) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="尚未配置设备能力" />}</div>
    </section>
  </div>;
  return <Panel className="admin-device-detail"><div className="admin-device-detail-summary"><div><span>设备 ID</span><strong className="mono">{value(device.id)}</strong></div><div><span>生命周期</span><Tag color="blue">{deviceLifecycleLabel(value(device.lifecycle_status, ""))}</Tag></div><div><span>分配状态</span><strong>{device.workspace_id ? "已分配" : "未分配"}</strong></div><div><span>资产状态</span><Tag color={device.status === "active" ? "green" : "default"}>{deviceStatusLabel(value(device.status, ""))}</Tag></div></div><Tabs className="admin-device-detail-tabs" items={[
    { key: "overview", label: "概览", children: overview },
    ...(isCarbon ? [{ key: "carbon", label: "碳汇数据", children: carbonManagement }] : [
      { key: "topology", label: "拓扑与能力", children: topology },
      { key: "configuration", label: "配置与属性", children: configuration },
      { key: "logs", label: "设备日志", children: <DeviceLogsPanel deviceId={value(device.id, "")} deviceName={value(device.name, "未命名设备")} /> },
    ]),
  ]} /></Panel>;
}

function ClaimCredentialSection({ device, date }: { device: JsonRecord; date: (input: unknown) => string }) {
  const deviceId = value(device.id, "");
  const query = useQuery({
    queryKey: ["admin", "device", deviceId, "claim-credential"],
    queryFn: () => api.admin.deviceClaimCredential(deviceId),
  });
  const credential = query.data;
  const configuredBase = (import.meta as ImportMeta & { env?: Record<string, string> }).env?.VITE_DEVICE_CLAIM_BASE_URL;
  const fallbackBase = window.location.origin.replace(/:5174$/, ":5173");
  const claimUrl = credential ? `${(configuredBase || fallbackBase).replace(/\/$/, "")}${credential.claim_path}` : "";
  const print = async () => {
    if (!credential) return;
    const popup = window.open("", "_blank", "width=520,height=720");
    if (!popup) return;
    const svg = document.getElementById(`claim-qr-${deviceId}`)?.outerHTML ?? "";
    popup.document.write(`<title>设备永久铭牌</title><style>body{font-family:system-ui;padding:32px;text-align:center}h1{font-size:22px}.code{font:700 22px ui-monospace;margin:16px}.sn{font:16px ui-monospace;color:#475569}svg{margin:24px}</style><h1>${credential.device_name}</h1>${svg}<div class="sn">SN ${credential.serial_no}</div><div class="code">${credential.manual_code}</div><p>扫码登录后认领设备</p>`);
    popup.document.close();
    popup.focus();
    popup.print();
    await api.admin.markDeviceClaimCredentialPrinted(deviceId);
    await query.refetch();
  };
  return <section className="admin-detail-section">
    <div className="admin-detail-section-head"><div><h2>永久认领铭牌</h2><span>二维码和手动认领码永久有效，可在设备解绑后重复使用</span></div>{credential ? <Space><Button icon={<Copy size={14} />} onClick={() => void navigator.clipboard.writeText(`${claimUrl}\nSN: ${credential.serial_no}\n认领码: ${credential.manual_code}`)}>复制</Button><Button type="primary" icon={<Printer size={14} />} onClick={() => void print()}>打印铭牌</Button></Space> : null}</div>
    {query.isLoading ? <div className="admin-inline-loading">正在加载永久铭牌…</div> : query.error ? <Alert type="warning" showIcon title="永久铭牌加载失败" description={formatApiError(query.error).message} /> : credential ? <div className="admin-claim-credential">
      <QRCodeSVG id={`claim-qr-${deviceId}`} value={claimUrl} size={148} level="M" marginSize={2} />
      <Descriptions bordered size="small" column={1} items={[
        { key: "url", label: "认领地址", children: <span className="mono admin-break-value">{claimUrl}</span> },
        { key: "sn", label: "设备 SN", children: <span className="mono">{credential.serial_no}</span> },
        { key: "code", label: "手动认领码", children: <strong className="mono">{credential.manual_code}</strong> },
        { key: "state", label: "当前状态", children: <Tag color={credential.is_claimable ? "green" : "blue"}>{credential.is_claimable ? "可认领" : "已分配，解绑后可再次认领"}</Tag> },
        { key: "printed", label: "最近打印", children: date(credential.printed_at) },
      ]} />
    </div> : null}
  </section>;
}

function columns() {
  return [
    {
      title: "设备",
      dataIndex: "name",
      render: (_: unknown, row: JsonRecord) => (
        <div>
          <div className="cell-title"><Link to={`/admin/devices/${encodeURIComponent(value(row.id, ""))}`}>{value(row.name, "未命名设备")}</Link></div>
          <div className="cell-sub mono">
            {value(row.serial_no, value(row.id))}
          </div>
        </div>
      ),
    },
    {
      title: "类型 / 拓扑",
      width: 130,
      render: (_: unknown, row: JsonRecord) => (
        <div>
          {deviceTopologyRoleLabel(value(row.device_type, ""))}
          <div className="cell-sub">
            {row.child_count
              ? `${row.child_count} 个子节点`
              : deviceTopologyRoleLabel(value(row.topology_role, ""))}
          </div>
        </div>
      ),
    },
    {
      title: "生命周期",
      dataIndex: "lifecycle_status",
      width: 120,
      render: (item: string) => (
        <Tag
          color={
            item === "online"
              ? "green"
              : item === "retired"
                ? "default"
                : "blue"
          }
        >
          {deviceLifecycleLabel(item)}
        </Tag>
      ),
    },
    {
      title: "工作区",
      dataIndex: "workspace_id",
      width: 145,
      render: (item: string) =>
        item ? <Tag color="blue">{item.slice(0, 8)}</Tag> : <Tag>未分配</Tag>,
    },
    {
      title: "状态",
      dataIndex: "status",
      width: 95,
      render: (item: string) => (
        <Tag color={item === "active" ? "green" : "default"}>
          {deviceStatusLabel(item)}
        </Tag>
      ),
    },
    {
      title: "操作",
      width: 100,
      fixed: "right" as const,
      render: (_: unknown, row: JsonRecord) => (
        <Button type="link"><Link to={`/admin/devices/${encodeURIComponent(value(row.id, ""))}`}>详情</Link></Button>
      ),
    },
  ];
}

function DeviceForm({
  mode,
  form,
  devices,
  deviceId,
}: {
  mode: Mode;
  form: FormInstance<any>;
  devices: JsonRecord[];
  deviceId: string;
}) {
  const workspaceId = Form.useWatch("target_workspace_id", form);
  const projectId = Form.useWatch("project_id", form);
  const workspaces = useQuery({
    queryKey: ["admin", "workspaces", "assignment"],
    queryFn: api.workspaces.adminList,
    enabled: mode === "assign" || mode === "camera",
  });
  const projects = useQuery({
    queryKey: ["admin", "projects", workspaceId],
    queryFn: () => api.projects.adminList(workspaceId),
    enabled: Boolean(workspaceId) && (mode === "assign" || mode === "camera"),
  });
  const sites = useQuery({
    queryKey: ["admin", "sites", workspaceId, projectId],
    queryFn: () => api.sites.adminList(workspaceId, projectId),
    enabled: Boolean(workspaceId) && (mode === "assign" || mode === "camera"),
  });
  const capabilityDefinitions = useQuery({
    queryKey: ["admin", "metadata", "capabilities"],
    queryFn: api.admin.metadata,
    enabled: mode === "capabilities",
  });
  const workspaceOptions = (workspaces.data?.items ?? []).map((item) => ({
    value: value(item.id, ""),
    label: value(item.name, value(item.id)),
  }));
  const projectOptions = (projects.data?.items ?? []).map((item) => ({
    value: value(item.id, ""),
    label: value(item.name, value(item.id)),
  }));
  const siteOptions = (sites.data?.items ?? []).map((item) => ({
    value: value(item.id, ""),
    label: value(item.name, value(item.id)),
  }));
  if (mode === "edit")
    return (
      <>
        <div className="drawer-grid">
          <Form.Item name="name" label="设备名称" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item
            name="serial_no"
            label="序列号"
            rules={[{ required: true }]}
          >
            <Input />
          </Form.Item>
        </div>
        <Form.Item name="product_id" label="产品 ID">
          <Input />
        </Form.Item>
        <div className="drawer-grid">
          <Form.Item name="device_type" label="设备类型">
            <Select
              options={["standalone", "gateway", "gateway_node", "camera", "carbon_sink"].map(
                (item) => ({
                  value: item,
                  label: deviceTopologyRoleLabel(item),
                }),
              )}
            />
          </Form.Item>
          <Form.Item name="status" label="资产状态">
            <Select
              options={deviceStatusOptions.map((item) => ({ value: item.value, label: deviceStatusLabel(item.value) }))}
            />
          </Form.Item>
        </div>
      </>
    );
  if (mode === "assign")
    return (
      <>
        <Form.Item
          name="target_workspace_id"
          label="目标工作区"
          rules={[{ required: true, message: "请选择工作区" }]}
        >
          <Select
            showSearch
            optionFilterProp="label"
            loading={workspaces.isLoading}
            options={workspaceOptions}
            onChange={() =>
              form.setFieldsValue({ project_id: undefined, site_id: undefined })
            }
          />
        </Form.Item>
        <div className="drawer-grid">
          <Form.Item name="project_id" label="项目">
            <Select
              allowClear
              showSearch
              optionFilterProp="label"
              disabled={!workspaceId}
              loading={projects.isLoading}
              options={projectOptions}
              onChange={() => form.setFieldValue("site_id", undefined)}
            />
          </Form.Item>
          <Form.Item name="site_id" label="站点">
            <Select
              allowClear
              showSearch
              optionFilterProp="label"
              disabled={!workspaceId}
              loading={sites.isLoading}
              options={siteOptions}
            />
          </Form.Item>
        </div>
        <Alert
          type="info"
          showIcon
          title="项目与站点选项会随工作区自动更新；网关节点自动继承网关归属"
        />
      </>
    );
  if (mode === "calibration")
    return (
      <>
        <Form.Item name="calibration_type" label="校准流程" rules={[{ required: true }]}>
          <Select options={[
            { value: "zero_point", label: "零点校准" },
            { value: "span", label: "量程校准" },
            { value: "factory_reset", label: "恢复出厂校准" },
            { value: "custom", label: "自定义流程" },
          ]} />
        </Form.Item>
        <Form.Item name="parameters" label="设备参数 JSON">
          <Input.TextArea rows={6} spellCheck={false} />
        </Form.Item>
      </>
    );
  if (mode === "firmware")
    return (
      <>
        <Form.Item name="firmware_version" label="目标版本" rules={[{ required: true }]}><Input placeholder="例如 2.4.1" /></Form.Item>
        <Form.Item name="package_uri" label="固件包 URI"><Input /></Form.Item>
        <Form.Item name="checksum" label="Checksum"><Input /></Form.Item>
        <Form.Item name="scheduled_at" label="计划执行时间"><Input type="datetime-local" /></Form.Item>
      </>
    );
  if (mode === "child")
    return (
      <>
        <Form.Item
          name="child_device_id"
          label="选择未组网节点"
          rules={[{ required: true, message: "请选择子设备" }]}
        >
          <Select
            showSearch
            optionFilterProp="label"
            options={devices
              .filter((item) => categoryFor(item) === "gateway_node")
              .map((item) => ({
                value: value(item.id, ""),
                label: `${value(item.name, "未命名")} · ${value(item.serial_no, String(item.id ?? "—"))}`,
              }))}
          />
        </Form.Item>
        <div className="drawer-note">
          <GitBranch size={15} />
          当前设备将成为父网关。系统会校验数据源、设备类型和现有拓扑关系。
        </div>
      </>
    );
  if (mode === "lifecycle")
    return (
      <>
        <Form.Item
          name="lifecycle_status"
          label="新生命周期"
          rules={[{ required: true }]}
        >
          <Select
            options={deviceLifecycleOptions.map((item) => ({ value: item.value, label: deviceLifecycleLabel(item.value) }))}
          />
        </Form.Item>
        <Form.Item name="note" label="变更说明">
          <Input.TextArea rows={4} placeholder="记录本次状态变化的原因" />
        </Form.Item>
      </>
    );
  if (mode === "capabilities")
    return (
      <>
        <Form.Item name="capabilities" label="设备能力">
          <Select
            mode="multiple"
            allowClear
            showSearch
            optionFilterProp="label"
            loading={capabilityDefinitions.isLoading}
            options={(capabilityDefinitions.data?.items ?? []).map((item) => ({
              value: value(item.code, ""),
              label: `${value(item.name, String(item.code ?? "—"))} · ${value(item.code)}`,
              disabled: item.status !== "active",
            }))}
            placeholder="选择设备最终生效的能力"
          />
        </Form.Item>
        <Alert
          type="warning"
          showIcon
          title="保存后将覆盖设备的最终能力集合"
          description="已停用的元数据能力不会出现在可选列表中；清空后设备不再声明任何能力。"
        />
      </>
    );
  if (mode === "config")
    return (
      <>
        <Alert
          type="info"
          showIcon
          title="可视化设备配置"
          description="保存会创建新的外部配置版本，并重新生成平台数据流和绑定。未知厂商字段会原样保留。"
        />
        <THCPNVisualConfigEditor deviceId={deviceId} form={form} />
      </>
    );
  if (mode === "camera")
    return (
      <>
        <div className="drawer-grid">
          <Form.Item
            name="name"
            label="监控站名称"
            rules={[{ required: true }]}
          >
            <Input />
          </Form.Item>
          <Form.Item
            name="serial_no"
            label="平台序列号"
            rules={[{ required: true }]}
          >
            <Input />
          </Form.Item>
        </div>
        <Form.Item
          name="device_serial"
          label="萤石设备序列号"
          rules={[{ required: true, message: "请输入萤石设备序列号" }]}
        >
          <Input />
        </Form.Item>
        <CameraBindingFields />
        <Form.Item name="target_workspace_id" label="目标工作区">
          <Select
            allowClear
            showSearch
            optionFilterProp="label"
            loading={workspaces.isLoading}
            options={workspaceOptions}
            placeholder="可选，留空则只创建系统资产"
            onChange={() =>
              form.setFieldsValue({ project_id: undefined, site_id: undefined })
            }
          />
        </Form.Item>
        <div className="drawer-grid">
          <Form.Item name="project_id" label="项目">
            <Select
              allowClear
              showSearch
              optionFilterProp="label"
              disabled={!workspaceId}
              loading={projects.isLoading}
              options={projectOptions}
              onChange={() => form.setFieldValue("site_id", undefined)}
            />
          </Form.Item>
          <Form.Item name="site_id" label="站点">
            <Select
              allowClear
              showSearch
              optionFilterProp="label"
              disabled={!workspaceId}
              loading={sites.isLoading}
              options={siteOptions}
            />
          </Form.Item>
        </div>
      </>
    );
  if (mode === "attributes") return null;
  return (
    <>
      <CameraBindingFields editing />
      <Form.Item name="status" label="绑定状态">
        <Select
          options={[
            { value: "active", label: "启用" },
            { value: "disabled", label: "停用" },
          ]}
        />
      </Form.Item>
    </>
  );
}

const categoryFor = (item: JsonRecord) =>
  value(item.topology_role || item.device_type, "standalone");

function ChildList({
  items,
  loading,
  onRemove,
}: {
  items: JsonRecord[];
  loading: boolean;
  onRemove: (id: string) => void;
}) {
  if (loading)
    return (
      <StateView
        type="loading"
        title="正在加载节点"
        description="正在读取网关拓扑关系。"
      />
    );
  if (!items.length)
    return (
      <StateView
        type="empty"
        title="暂无子节点"
        description="可通过拓扑操作添加同一数据源中的节点。"
      />
    );
  return (
    <div className="admin-child-list">
      {items.map((item) => {
        const device = (item.device ?? item) as JsonRecord;
        return (
          <div key={value(device.id)}>
            <div>
              <strong>{value(device.name, "未命名节点")}</strong>
              <span className="mono">
                {value(device.serial_no, String(device.id ?? "—"))}
              </span>
            </div>
            <div>
              <Tag color={device.workspace_id ? "blue" : "default"}>
                {device.workspace_id ? "已分配" : "未分配"}
              </Tag>
              <Popconfirm
                title="移除拓扑关系？"
                description="只解除父子关系，不删除设备资产。"
                onConfirm={() => onRemove(value(device.id, ""))}
              >
                <Button
                  type="text"
                  danger
                  icon={<Trash2 size={14} />}
                  aria-label="移除节点"
                />
              </Popconfirm>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function StructuredDetail({
  mode,
  detail,
  busy,
  onRemove,
}: {
  mode: Mode;
  detail: unknown;
  busy: boolean;
  onRemove: (id: string) => void;
}) {
  if (busy && (mode === "child" || mode === "lifecycle" || mode === "attributes"))
    return (
      <StateView
        type="loading"
        title="正在加载详情"
        description="正在读取设备记录。"
      />
    );
  if (!detail || typeof detail !== "object") return null;
  const record = detail as JsonRecord;
  if (mode === "child")
    return (
      <section className="drawer-structured-detail">
        <h3>当前拓扑节点</h3>
        <ChildList
          items={(record.items as JsonRecord[]) ?? []}
          loading={false}
          onRemove={onRemove}
        />
      </section>
    );
  if (mode === "lifecycle") {
    const events = (record.events as JsonRecord[]) ?? [];
    return (
      <section className="drawer-structured-detail">
        <h3>生命周期历史</h3>
        {events.length ? (
          <div className="lifecycle-timeline">
            {events.map((event) => (
              <div key={value(event.id)}>
                <i />
                <div>
                  <strong>
                    {event.from_status
                      ? deviceLifecycleLabel(value(event.from_status, ""))
                      : "初始"}{" "}
                    → {deviceLifecycleLabel(value(event.to_status, ""))}
                  </strong>
                  <span>
                    {event.occurred_at
                      ? new Intl.DateTimeFormat(document.documentElement.lang || "zh-CN", {
                          dateStyle: "medium",
                          timeStyle: "short",
                        }).format(new Date(value(event.occurred_at)))
                      : "—"}
                  </span>
                  {event.note ? <p>{value(event.note)}</p> : null}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <StateView
            type="empty"
            title="暂无历史事件"
            description="首次更新生命周期后会在这里形成可追溯记录。"
          />
        )}
      </section>
    );
  }
  if (mode === "attributes") {
    const attributes = (record.attributes as JsonRecord) ?? {};
    return (
      <section className="drawer-structured-detail">
        <h3>最新设备属性</h3>
        {Object.keys(attributes).length ? (
          <div className="drawer-grid">
            {Object.entries(attributes).map(([key, item]) => {
              const attribute = item as JsonRecord;
              const parsed = attribute.parsed_value ?? attribute.raw_value;
              return (
                <div key={key} className="detail-field">
                  <span>{key === "battery" ? "电池" : key === "signal" ? "信号" : key}</span>
                  <strong>{typeof parsed === "object" ? JSON.stringify(parsed) : value(parsed)}</strong>
                  <small>{value(attribute.sampled_at)}</small>
                </div>
              );
            })}
          </div>
        ) : <StateView type="empty" title="暂无设备属性" description="THCPN 当前没有返回电池、信号或扩展信息。" />}
      </section>
    );
  }
  return null;
}

function ConfigContext({ detail }: { detail: JsonRecord }) {
  const latest = (detail.latest_config ?? {}) as JsonRecord;
  const snapshot = (detail.latest_snapshot ?? {}) as JsonRecord;
  const time = (input: unknown) =>
    input
      ? new Intl.DateTimeFormat(document.documentElement.lang || "zh-CN", {
          dateStyle: "medium",
          timeStyle: "short",
        }).format(new Date(String(input)))
      : "—";
  return (
    <section className="config-context">
      <h3>当前配置范围</h3>
      <div>
        <span>
          <small>外部设备 ID</small>
          <strong>{value(detail.external_device_id)}</strong>
        </span>
        <span>
          <small>配置版本</small>
          <strong>{value(latest.version, "未标记")}</strong>
        </span>
        <span>
          <small>外部更新时间</small>
          <strong>{time(latest.updated_at)}</strong>
        </span>
        <span>
          <small>平台同步时间</small>
          <strong>{time(snapshot.synced_at)}</strong>
        </span>
      </div>
    </section>
  );
}

function ConfigApplyResult({
  result,
  onClose,
}: {
  result: { deviceName: string; response: JsonRecord };
  onClose: () => void;
}) {
  const response = result.response;
  const count = (key: string) =>
    Array.isArray(response[key]) ? response[key].length : 0;
  const warnings = Array.isArray(response.warnings)
    ? (response.warnings as JsonRecord[])
    : [];
  const config = (response.config ?? {}) as JsonRecord;
  return (
    <Panel className="section-gap sync-result">
      <div className="panel-header">
        <div>
          <h2 className="panel-title">配置应用结果 · {result.deviceName}</h2>
          <div className="panel-kicker">
            外部配置版本 {value(config.version, value(config.id))}{" "}
            已写入并同步至平台
          </div>
        </div>
        <Space>
          <Tag color={warnings.length ? "orange" : "green"}>
            {warnings.length ? `${warnings.length} 条警告` : "应用成功"}
          </Tag>
          <Button type="text" onClick={onClose}>
            关闭
          </Button>
        </Space>
      </div>
      <div className="sync-result-metrics">
        <div>
          <strong>{count("data_streams")}</strong>
          <span>生效 DataStream</span>
        </div>
        <div>
          <strong>{count("bindings")}</strong>
          <span>生效 Binding</span>
        </div>
        <div>
          <strong>{count("disabled_data_streams")}</strong>
          <span>禁用 DataStream</span>
        </div>
        <div>
          <strong>{count("disabled_bindings")}</strong>
          <span>禁用 Binding</span>
        </div>
      </div>
      {warnings.length ? (
        <div className="sync-warnings">
          {warnings.map((warning, index) => (
            <div key={`${value(warning.code, "warning")}-${index}`}>
              <strong>{value(warning.code, "warning")}</strong>
              <span>{value(warning.message, "配置应用返回警告")}</span>
            </div>
          ))}
        </div>
      ) : null}
    </Panel>
  );
}

function CameraBindingFields({ editing = false }: { editing?: boolean }) {
  return (
    <>
      <div className="drawer-grid">
        {editing && (
          <Form.Item
            name="device_serial"
            label="萤石设备序列号"
            rules={[{ required: true }]}
          >
            <Input />
          </Form.Item>
        )}
        <Form.Item
          name="channel_no"
          label="通道号"
          rules={[{ required: true }]}
        >
          <InputNumber min={1} precision={0} style={{ width: "100%" }} />
        </Form.Item>
        <Form.Item name="default_quality" label="默认清晰度">
          <Select
            options={["fluent", "standard", "hd", "ultra_hd"].map((item) => ({
              value: item,
              label: item,
            }))}
          />
        </Form.Item>
      </div>
      <Form.Item name="is_encrypted" label="设备加密">
        <Select
          options={[
            { value: false, label: "未加密" },
            { value: true, label: "已加密" },
          ]}
        />
      </Form.Item>
      <Form.Item name="validate_code_secret_ref" label="验证码 Secret 引用">
        <Input placeholder="例如 env://EZVIZ_VALIDATE_CODE" />
      </Form.Item>
    </>
  );
}

function drawerTitle(mode: Mode, selected: JsonRecord | null) {
  if (mode === "camera" && !selected) return "创建监控站";
  const name = value(selected?.name, "设备");
  return (
    (
      {
        edit: "编辑资料",
        assign: "分配工作区",
        child: "添加子节点",
        lifecycle: "更新生命周期",
        capabilities: "设备能力",
        config: "THCPN 高级配置",
        calibration: "设备校准",
        firmware: "固件升级",
        camera: "创建监控站",
        "camera-edit": "编辑监控站视频绑定",
      } as Record<string, string>
    )[mode ?? ""] + ` · ${name}`
  );
}
