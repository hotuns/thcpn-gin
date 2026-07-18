import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { GitBranch, RefreshCw, Search, Settings2, Trash2 } from "lucide-react";
import {
  Alert,
  Button,
  Drawer,
  Form,
  Input,
  InputNumber,
  Popconfirm,
  Select,
  Space,
  Table,
  Tag,
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
  validateConfigField,
  type THCPNConfigFields,
} from "./thcpn-config";

type Mode =
  | "edit"
  | "assign"
  | "child"
  | "lifecycle"
  | "capabilities"
  | "attributes"
  | "config"
  | "camera"
  | "camera-edit"
  | null;
const value = (input: unknown, fallback = "—") =>
  input === undefined || input === null || input === ""
    ? fallback
    : String(input);

export function AdminDevicesPage() {
  const query = useQuery({
    queryKey: ["admin", "devices"],
    queryFn: api.admin.devices,
  });
  const [keyword, setKeyword] = useState("");
  const [status, setStatus] = useState("");
  const [lifecycle, setLifecycle] = useState("");
  const [assignment, setAssignment] = useState("");
  const [category, setCategory] = useState("all");
  const [selected, setSelected] = useState<JsonRecord | null>(null);
  const [mode, setMode] = useState<Mode>(null);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [detail, setDetail] = useState<unknown>(null);
  const [configResult, setConfigResult] = useState<{
    deviceName: string;
    response: JsonRecord;
  } | null>(null);
  const [children, setChildren] = useState<Record<string, JsonRecord[]>>({});
  const [form] = Form.useForm();
  const allRows = query.data?.items ?? [];
  const categoryOf = (item: JsonRecord) =>
    value(item.topology_role || item.device_type, "standalone");
  const counts = useMemo(
    () => ({
      all: allRows.length,
      gateway: allRows.filter((item) => categoryOf(item) === "gateway").length,
      gateway_node: allRows.filter(
        (item) => categoryOf(item) === "gateway_node",
      ).length,
      camera: allRows.filter((item) => categoryOf(item) === "camera").length,
      standalone: allRows.filter((item) => categoryOf(item) === "standalone")
        .length,
    }),
    [allRows],
  );
  const rows = useMemo(
    () =>
      allRows.filter((item) => {
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
    [allRows, keyword, status, lifecycle, assignment, category],
  );
  const id = value(selected?.id, "");

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
        assign_children: false,
      });
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
      });
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
    if (
      mode === "config" &&
      !window.confirm(
        "确认写入 THCPN 外部设备库并刷新平台 DataStream 与 Binding？",
      )
    )
      return;
    setBusy(true);
    setFeedback("");
    try {
      const fields = await form.validateFields();
      if (!selected && mode !== "camera") throw new Error("请先选择设备");
      if (mode === "edit") await api.admin.updateDevice(id, fields);
      if (mode === "assign") await api.admin.assignDevice(id, fields);
      if (mode === "child") await api.admin.addDeviceChild(id, fields);
      if (mode === "lifecycle") await api.admin.updateLifecycle(id, fields);
      if (mode === "capabilities")
        await api.admin.updateCapabilities(id, {
          capabilities: fields.capabilities ?? [],
        });
      if (mode === "config") {
        const response = await api.admin.updateDeviceConfig(
          id,
          parseTHCPNConfig(fields as THCPNConfigFields),
        );
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
      setFeedback("操作已完成");
      close();
      await query.refetch();
    } catch (error) {
      if (!(error as any)?.errorFields) showError(error);
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

  return (
    <>
      <PageHeader
        eyebrow="System / devices"
        title="系统设备"
        description="管理设备身份、工作区分配、网关拓扑、生命周期和 THCPN 配置。"
        actions={
          <Button
            icon={<RefreshCw size={14} />}
            onClick={() => void query.refetch()}
          >
            刷新
          </Button>
        }
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
            options={deviceStatusOptions.map((item) => ({ ...item }))}
          />
          <Select
            allowClear
            placeholder="生命周期"
            value={lifecycle || undefined}
            onChange={(item) => setLifecycle(item ?? "")}
            options={deviceLifecycleOptions.map((item) => ({ ...item }))}
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
            { key: "gateway", label: "网关" },
            { key: "gateway_node", label: "节点" },
            { key: "camera", label: "相机" },
            { key: "standalone", label: "标准站" },
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
            rowClassName={(record) =>
              record.id === selected?.id ? "admin-selected-row" : ""
            }
            columns={columns(open, unassign)}
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
            pagination={{ pageSize: 12, showSizeChanger: false }}
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
      {configResult ? (
        <ConfigApplyResult
          result={configResult}
          onClose={() => setConfigResult(null)}
        />
      ) : null}
      <Drawer
        title={drawerTitle(mode, selected)}
        open={Boolean(mode)}
        onClose={close}
        size={620}
        extra={mode === "attributes" ? (
          <Button onClick={close}>关闭</Button>
        ) : (
          <Space>
            <Button onClick={close}>取消</Button>
            <Button
              type="primary"
              danger={mode === "config"}
              loading={busy}
              onClick={() => void submit()}
            >
              保存
            </Button>
          </Space>
        )}
      >
        <Form form={form} layout="vertical">
          <DeviceForm mode={mode} form={form} devices={allRows} />
        </Form>
        <StructuredDetail
          mode={mode}
          detail={detail}
          busy={busy}
          onRemove={(childId) =>
            selected && void removeChild(value(selected.id, ""), childId)
          }
        />
        {mode === "config" && detail ? (
          <ConfigContext detail={detail as JsonRecord} />
        ) : null}
        <div className="drawer-note">
          <Settings2 size={15} />
          {mode === "config"
            ? "高级配置会写入外部设备库，并刷新平台数据流与绑定。提交前请确认 JSON 结构。"
            : "所有操作都作用于标题中显示的当前设备；完成后设备列表会自动刷新。"}
        </div>
      </Drawer>
    </>
  );
}

function columns(
  open: (mode: Exclude<Mode, null>, row: JsonRecord) => void,
  unassign: (row: JsonRecord) => Promise<void>,
) {
  return [
    {
      title: "设备",
      dataIndex: "name",
      render: (_: unknown, row: JsonRecord) => (
        <div>
          <div className="cell-title">{value(row.name, "未命名设备")}</div>
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
      width: 360,
      fixed: "right" as const,
      render: (_: unknown, row: JsonRecord) => (
        <Space size={0} wrap>
          <Button type="link" onClick={() => open("edit", row)}>
            资料
          </Button>
          <Button type="link" onClick={() => open("assign", row)}>
            分配
          </Button>
          <Button type="link" onClick={() => open("child", row)}>
            拓扑
          </Button>
          <Button type="link" onClick={() => open("lifecycle", row)}>
            生命周期
          </Button>
          <Button type="link" onClick={() => open("capabilities", row)}>
            能力
          </Button>
          <Button type="link" onClick={() => open("attributes", row)}>
            属性
          </Button>
          <Button type="link" onClick={() => open("config", row)}>
            配置
          </Button>
          <Button type="link">
            <Link to={`/admin/logs?device=${encodeURIComponent(value(row.id, ""))}`}>日志</Link>
          </Button>
          <Button
            type="link"
            onClick={() =>
              open(
                row.device_type === "camera" || row.topology_role === "camera"
                  ? "camera-edit"
                  : "camera",
                row,
              )
            }
          >
            {row.device_type === "camera" || row.topology_role === "camera"
              ? "相机绑定"
              : "建相机"}
          </Button>
          {Boolean(row.workspace_id) && (
            <Popconfirm
              title="解除工作区分配？"
              description="设备将不再对该工作区可见。"
              onConfirm={() => void unassign(row)}
            >
              <Button type="link" danger>
                解除
              </Button>
            </Popconfirm>
          )}
        </Space>
      ),
    },
  ];
}

function DeviceForm({
  mode,
  form,
  devices,
}: {
  mode: Mode;
  form: ReturnType<typeof Form.useForm>[0];
  devices: JsonRecord[];
}) {
  const workspaceId = Form.useWatch("target_workspace_id", form);
  const projectId = Form.useWatch("project_id", form);
  const controlJSON = Form.useWatch("control_json", form);
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
              options={["standalone", "gateway", "gateway_node", "camera"].map(
                (item) => ({
                  value: item,
                  label: deviceTopologyRoleLabel(item),
                }),
              )}
            />
          </Form.Item>
          <Form.Item name="status" label="资产状态">
            <Select
              options={deviceStatusOptions.map((item) => ({ ...item }))}
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
        <Form.Item name="assign_children" label="网关子节点">
          <Select
            options={[
              { value: false, label: "只分配当前设备" },
              { value: true, label: "同时分配全部子节点" },
            ]}
          />
        </Form.Item>
        <Alert
          type="info"
          showIcon
          title="项目与站点选项会随工作区自动更新"
        />
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
            options={deviceLifecycleOptions.map((item) => ({ ...item }))}
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
          type="warning"
          showIcon
          title="将创建新的外部配置版本"
          description="只编辑以下三个配置字段。保存后系统会写入外部设备库，并重新生成平台数据流和绑定。"
        />
        <Form.Item
          name="data_json"
          label="数据通道 · data_json"
          rules={[
            { required: true },
            {
              validator: (_, current) => validateConfigField(current, "array"),
            },
          ]}
        >
          <Input.TextArea rows={10} className="code-input" spellCheck={false} />
        </Form.Item>
        <Form.Item
          name="image_json"
          label="图片通道 · image_json"
          rules={[
            { required: true },
            {
              validator: (_, current) => validateConfigField(current, "array"),
            },
          ]}
        >
          <Input.TextArea rows={8} className="code-input" spellCheck={false} />
        </Form.Item>
        <Form.Item
          name="control_json"
          label="控制配置 · control_json"
          rules={[
            { required: true },
            {
              validator: (_, current) => validateConfigField(current, "object"),
            },
          ]}
          extra={`采集策略：${describeSamplingControl(controlJSON)}`}
        >
          <Input.TextArea rows={8} className="code-input" spellCheck={false} />
        </Form.Item>
      </>
    );
  if (mode === "camera")
    return (
      <>
        <div className="drawer-grid">
          <Form.Item
            name="name"
            label="平台相机名称"
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
                      ? new Intl.DateTimeFormat("zh-CN", {
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
      ? new Intl.DateTimeFormat("zh-CN", {
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
        camera: "创建相机",
        "camera-edit": "编辑相机绑定",
      } as Record<string, string>
    )[mode ?? ""] + ` · ${name}`
  );
}
