import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Leaf, Plus, RefreshCw, Search, Settings2, ShieldCheck } from "lucide-react";
import { AutoComplete } from "antd";
import {
  Button,
  Drawer,
  Form,
  Input,
  InputNumber,
  Popconfirm,
  Select,
  Space,
  Table,
  Tabs,
  Tag,
} from "@thcpn/admin-ui";
import {
  ApiError,
  api,
  formatApiError,
  roleTemplateLabel,
  type DeviceTaxonomyTerm,
  type JsonRecord,
} from "@thcpn/api";
import { Badge, PageHeader, Panel, StateView } from "@thcpn/ui";
import { iconifyIconUrl } from "@thcpn/device-map";

const value = (input: unknown, fallback = "—") =>
  input === undefined || input === null || input === ""
    ? fallback
    : String(input);
const formatTime = (input: unknown) =>
  input
    ? new Intl.DateTimeFormat(document.documentElement.lang || "zh-CN", {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(new Date(String(input)))
    : "—";

const deviceTypeIcons = [
  { value: "mdi:pine-tree", label: "森林" },
  { value: "mdi:sprout", label: "草地" },
  { value: "mdi:barley", label: "农田" },
  { value: "mdi:waves", label: "湿地" },
  { value: "mdi:white-balance-sunny", label: "荒漠" },
  { value: "mdi:city-variant-outline", label: "城市" },
  { value: "mdi:water", label: "水域" },
  { value: "mdi:terrain", label: "山地" },
  { value: "mdi:leaf", label: "其他" },
] as const;
const EcosystemIcon = ({ name, size = 16 }: { name?: string; size?: number }) => {
  const src = iconifyIconUrl(name);
  return src ? <img src={src} width={size} height={size} alt="" /> : <Leaf size={size} />;
};

export function AdminMetadataPage() {
  const [tab, setTab] = useState("profile-options");
  return (
    <>
      <PageHeader
        eyebrow="System / metadata"
        title="元数据"
        description="维护用户填写设备资料时可选的元数据、设备能力和系统角色。"
        actions={
          <Badge tone="info">
            <ShieldCheck size={13} />
            SYSTEM SCOPE
          </Badge>
        }
      />
      <Tabs
        activeKey={tab}
        onChange={setTab}
        items={[
          {
            key: "profile-options",
            label: "设备资料选项",
            children: <ProfileOptions />,
          },
          {
            key: "capabilities",
            label: "设备能力",
            children: <Capabilities />,
          },
          { key: "roles", label: "系统角色", children: <Roles /> },
        ]}
      />
    </>
  );
}

function ProfileOptions() {
  const query = useQuery({ queryKey: ["admin", "device-taxonomy"], queryFn: api.admin.deviceTaxonomy });
  const [kind, setKind] = useState<"ecosystem" | "observation_object">("ecosystem");
  const [editing, setEditing] = useState<DeviceTaxonomyTerm | "new" | null>(null);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [form] = Form.useForm();
  const selectedIcon = Form.useWatch("icon", form);
  const rows = (query.data?.items ?? []).filter((item) => item.kind === kind);
  const open = (item: DeviceTaxonomyTerm | "new") => {
    setEditing(item);
    form.setFieldsValue(item === "new" ? { code: "", name_zh: "", name_en: "", status: "active", sort_order: 100, icon: kind === "ecosystem" ? "mdi:leaf" : undefined } : item);
  };
  const close = () => { setEditing(null); form.resetFields(); };
  const save = async () => {
    setBusy(true); setFeedback("");
    try {
      const fields = await form.validateFields();
      await api.admin.upsertDeviceTaxonomy({ ...fields, kind, id: editing !== "new" ? editing?.id : undefined });
      setFeedback(editing === "new" ? "选项已新增" : "选项已更新");
      close(); await query.refetch();
    } catch (error) {
      if (!(error as any)?.errorFields) setFeedback(formatApiError(error).message);
    } finally { setBusy(false); }
  };
  const remove = async (item: DeviceTaxonomyTerm) => {
    try {
      await api.admin.deleteDeviceTaxonomy(item.id);
      setFeedback("选项已删除"); await query.refetch();
    } catch (error) {
      setFeedback(error instanceof ApiError && error.status === 409 ? "该选项正在被设备或样地使用，不能删除；可以改为停用。" : formatApiError(error).message);
    }
  };
  return <>
    <Panel>
      <div className="admin-list-toolbar">
        <Select value={kind} onChange={setKind} style={{ width: 180 }} options={[{ value: "ecosystem", label: "设备类型" }, { value: "observation_object", label: "观测对象" }]} />
        <Space><Button icon={<RefreshCw size={14} />} onClick={() => void query.refetch()}>刷新</Button><Button type="primary" icon={<Plus size={14} />} onClick={() => open("new")}>新增选项</Button></Space>
      </div>
      {feedback && <div className="admin-feedback">{feedback}</div>}
      {query.isLoading ? <StateView type="loading" title="正在加载设备资料选项" description="正在读取设备类型和观测对象。" /> : query.error ? <StateView type="error" title="设备资料选项加载失败" description={formatApiError(query.error).message} /> : <Table rowKey="id" dataSource={rows} columns={[
        ...(kind === "ecosystem" ? [{ title: "图标", width: 70, render: (_: unknown, item: DeviceTaxonomyTerm) => <EcosystemIcon name={item.icon} /> }] : []),
        { title: "名称", render: (_: unknown, item: DeviceTaxonomyTerm) => <div><div className="cell-title">{item.name_zh}</div><div className="cell-sub">{item.name_en}</div></div> },
        { title: "编码", dataIndex: "code", className: "mono" },
        { title: "状态", width: 90, render: (_: unknown, item: DeviceTaxonomyTerm) => <Tag color={item.status === "active" ? "green" : "default"}>{item.status === "active" ? "启用" : "停用"}</Tag> },
        { title: "排序", dataIndex: "sort_order", width: 80 },
        { title: "操作", width: 150, render: (_: unknown, item: DeviceTaxonomyTerm) => <Space><Button type="link" onClick={() => open(item)}>编辑</Button><Popconfirm title="删除这个选项？" description="已被设备或样地使用的选项无法删除。" onConfirm={() => void remove(item)}><Button type="link" danger>删除</Button></Popconfirm></Space> },
      ]} pagination={false} />}
    </Panel>
    <Drawer title={editing === "new" ? `新增${kind === "ecosystem" ? "设备类型" : "观测对象"}` : "编辑选项"} open={Boolean(editing)} onClose={close} size={420} extra={<Space><Button onClick={close}>取消</Button><Button type="primary" loading={busy} onClick={() => void save()}>保存</Button></Space>}>
      <Form form={form} layout="vertical">
        <Form.Item name="code" label="稳定编码" rules={[{ required: true, message: "请输入编码" }]}><Input disabled={editing !== "new"} placeholder="例如 forest" /></Form.Item>
        <Form.Item name="name_zh" label="中文名称" rules={[{ required: true, message: "请输入中文名称" }]}><Input /></Form.Item>
        <Form.Item name="name_en" label="英文名称" rules={[{ required: true, message: "请输入英文名称" }]}><Input /></Form.Item>
        {kind === "ecosystem" && <Form.Item name="icon" label="分类图标" rules={[{ pattern: /^[a-z0-9-]+:[a-z0-9-]+$/, message: "请输入有效的 Iconify 标识，例如 mdi:pine-tree" }]}><AutoComplete options={deviceTypeIcons.map(({ value, label }) => ({ value, label: <Space><EcosystemIcon name={value} />{label}<span className="mono">{value}</span></Space> }))}><Input prefix={<EcosystemIcon name={selectedIcon} />} placeholder="输入 Iconify 标识，例如 mdi:pine-tree" /></AutoComplete></Form.Item>}
        <Form.Item name="status" label="状态"><Select options={[{ value: "active", label: "启用" }, { value: "inactive", label: "停用" }]} /></Form.Item>
        <Form.Item name="sort_order" label="排序"><InputNumber precision={0} style={{ width: "100%" }} /></Form.Item>
      </Form>
    </Drawer>
  </>;
}

function Capabilities() {
  const query = useQuery({
    queryKey: ["admin", "metadata", "capabilities"],
    queryFn: api.admin.metadata,
  });
  const [keyword, setKeyword] = useState("");
  const [editing, setEditing] = useState<JsonRecord | null>(null);
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [form] = Form.useForm();
  const rows = useMemo(
    () =>
      (query.data?.items ?? []).filter((item) =>
        `${value(item.code)} ${value(item.name)}`
          .toLowerCase()
          .includes(keyword.toLowerCase()),
      ),
    [keyword, query.data],
  );
  const openCreate = () => {
    form.setFieldsValue({
      code: "",
      name: "",
      status: "active",
      sort_order: 100,
    });
    setCreating(true);
    setEditing(null);
  };
  const openEdit = (record: JsonRecord) => {
    form.setFieldsValue({
      name: record.name,
      status: record.status,
      sort_order: record.sort_order,
    });
    setEditing(record);
    setCreating(false);
  };
  const close = () => {
    setEditing(null);
    setCreating(false);
    form.resetFields();
  };
  const submit = async () => {
    setBusy(true);
    setFeedback("");
    try {
      const payload = await form.validateFields();
      if (editing)
        await api.admin.updateCapabilityDefinition(
          value(editing.code),
          payload,
        );
      else await api.admin.createCapabilityDefinition(payload);
      setFeedback(editing ? "能力定义已更新" : "能力定义已创建");
      close();
      await query.refetch();
    } catch (error) {
      if ((error as any)?.errorFields) return;
      const detail = formatApiError(error);
      setFeedback(
        `${detail.message}${detail.requestId ? ` · request id ${detail.requestId}` : ""}`,
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <Panel>
        <div className="admin-list-toolbar">
          <div className="admin-search">
            <Search size={15} />
            <input
              value={keyword}
              onChange={(event) => setKeyword(event.target.value)}
              placeholder="搜索 code 或名称"
            />
          </div>
          <Space>
            <Button
              icon={<RefreshCw size={14} />}
              onClick={() => void query.refetch()}
            >
              刷新
            </Button>
            <Button
              type="primary"
              icon={<Plus size={14} />}
              onClick={openCreate}
            >
              新增能力
            </Button>
          </Space>
        </div>
        {feedback && <div className="admin-feedback">{feedback}</div>}
        {query.isLoading ? (
          <StateView
            type="loading"
            title="正在加载能力目录"
            description="正在读取系统元数据。"
          />
        ) : query.error ? (
          <StateView
            type="error"
            title="能力目录加载失败"
            description={formatApiError(query.error).message}
            requestId={formatApiError(query.error).requestId}
          />
        ) : (
          <Table
            rowKey="code"
            dataSource={rows}
            columns={[
              {
                title: "能力",
                dataIndex: "name",
                render: (_, record: JsonRecord) => (
                  <div>
                    <div className="cell-title">{value(record.name)}</div>
                    <div className="cell-sub mono">{value(record.code)}</div>
                  </div>
                ),
              },
              {
                title: "状态",
                dataIndex: "status",
                width: 120,
                render: (status) => (
                  <Tag color={status === "active" ? "green" : "default"}>
                    {value(status)}
                  </Tag>
                ),
              },
              { title: "排序", dataIndex: "sort_order", width: 100 },
              {
                title: "更新时间",
                dataIndex: "updated_at",
                width: 190,
                render: formatTime,
              },
              {
                title: "操作",
                width: 90,
                render: (_, record: JsonRecord) => (
                  <Button type="link" onClick={() => openEdit(record)}>
                    编辑
                  </Button>
                ),
              },
            ]}
            pagination={{ pageSize: 12, showSizeChanger: false }}
            scroll={{ x: 720 }}
          />
        )}
      </Panel>
      <Drawer
        title={editing ? `编辑能力 · ${value(editing.code)}` : "新增设备能力"}
        open={Boolean(editing) || creating}
        onClose={close}
        size={420}
        extra={
          <Space>
            <Button onClick={close}>取消</Button>
            <Button type="primary" loading={busy} onClick={() => void submit()}>
              保存
            </Button>
          </Space>
        }
      >
        <Form form={form} layout="vertical">
          <Form.Item
            name="code"
            label="能力代码"
            rules={[{ required: !editing, message: "请输入能力代码" }]}
            tooltip="创建后不可修改"
          >
            <Input disabled={Boolean(editing)} placeholder="例如 telemetry" />
          </Form.Item>
          <Form.Item
            name="name"
            label="显示名称"
            rules={[{ required: true, message: "请输入显示名称" }]}
          >
            <Input placeholder="例如 设备数据" />
          </Form.Item>
          <Form.Item name="status" label="状态" rules={[{ required: true }]}>
            <Select
              options={[
                { value: "active", label: "启用" },
                { value: "disabled", label: "停用" },
              ]}
            />
          </Form.Item>
          <Form.Item
            name="sort_order"
            label="排序值"
            rules={[{ required: true, message: "请输入排序值" }]}
          >
            <InputNumber precision={0} style={{ width: "100%" }} />
          </Form.Item>
        </Form>
        <div className="drawer-note">
          <Settings2 size={15} />
          能力代码用于设备绑定和权限判断，创建后保持稳定；停用不会自动删除设备已有配置。
        </div>
      </Drawer>
    </>
  );
}

function Roles() {
  const query = useQuery({
    queryKey: ["admin", "metadata", "roles"],
    queryFn: api.admin.roles,
  });
  const [keyword, setKeyword] = useState("");
  const [editing, setEditing] = useState<JsonRecord | null>(null);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [form] = Form.useForm();
  const rows = useMemo(
    () =>
      (query.data?.items ?? []).filter((item) =>
        `${value(item.code)} ${value(item.name)}`
          .toLowerCase()
          .includes(keyword.toLowerCase()),
      ),
    [keyword, query.data],
  );
  const open = (record: JsonRecord) => {
    setEditing(record);
    form.setFieldsValue({
      name: roleTemplateLabel(value(record.code, ""), value(record.name, "")),
    });
  };
  const close = () => {
    setEditing(null);
    form.resetFields();
  };
  const submit = async () => {
    if (!editing) return;
    setBusy(true);
    setFeedback("");
    try {
      const payload = await form.validateFields();
      await api.admin.updateRole(value(editing.code), payload);
      setFeedback("角色名称已更新");
      close();
      await query.refetch();
    } catch (error) {
      if ((error as any)?.errorFields) return;
      const detail = formatApiError(error);
      setFeedback(
        `${detail.message}${detail.requestId ? ` · request id ${detail.requestId}` : ""}`,
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <Panel>
        <div className="admin-list-toolbar">
          <div className="admin-search">
            <Search size={15} />
            <input
              value={keyword}
              onChange={(event) => setKeyword(event.target.value)}
              placeholder="搜索角色 code 或名称"
            />
          </div>
          <Button
            icon={<RefreshCw size={14} />}
            onClick={() => void query.refetch()}
          >
            刷新
          </Button>
        </div>
        {feedback && <div className="admin-feedback">{feedback}</div>}
        {query.isLoading ? (
          <StateView
            type="loading"
            title="正在加载系统角色"
            description="正在读取系统角色元数据。"
          />
        ) : query.error ? (
          <StateView
            type="error"
            title="角色加载失败"
            description={formatApiError(query.error).message}
            requestId={formatApiError(query.error).requestId}
          />
        ) : (
          <Table
            rowKey="code"
            dataSource={rows}
            columns={[
              {
                title: "角色",
                dataIndex: "name",
                render: (_, record: JsonRecord) => (
                  <div>
                    <div className="cell-title">
                      {roleTemplateLabel(
                        value(record.code, ""),
                        value(record.name, ""),
                      )}
                    </div>
                    <div className="cell-sub mono">{value(record.code)}</div>
                  </div>
                ),
              },
              {
                title: "创建时间",
                dataIndex: "created_at",
                width: 190,
                render: formatTime,
              },
              {
                title: "更新时间",
                dataIndex: "updated_at",
                width: 190,
                render: formatTime,
              },
              {
                title: "操作",
                width: 90,
                render: (_, record: JsonRecord) => (
                  <Button type="link" onClick={() => open(record)}>
                    重命名
                  </Button>
                ),
              },
            ]}
            pagination={false}
            scroll={{ x: 620 }}
          />
        )}
      </Panel>
      <Drawer
        title={`编辑角色 · ${value(editing?.code)}`}
        open={Boolean(editing)}
        onClose={close}
        size={400}
        extra={
          <Space>
            <Button onClick={close}>取消</Button>
            <Button type="primary" loading={busy} onClick={() => void submit()}>
              保存
            </Button>
          </Space>
        }
      >
        <Form form={form} layout="vertical">
          <Form.Item
            name="name"
            label="角色显示名称"
            rules={[{ required: true, message: "请输入角色名称" }]}
          >
            <Input />
          </Form.Item>
        </Form>
        <div className="drawer-note">
          <ShieldCheck size={15} />
          这里只修改显示名称。角色 code
          与权限集合保持不变，不会改变已有成员的授权范围。
        </div>
      </Drawer>
    </>
  );
}
