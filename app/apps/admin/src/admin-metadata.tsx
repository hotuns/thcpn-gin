import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Plus, RefreshCw, Search, Settings2, ShieldCheck } from "lucide-react";
import {
  Button,
  Drawer,
  Form,
  Input,
  InputNumber,
  Select,
  Space,
  Table,
  Tabs,
  Tag,
} from "@thcpn/admin-ui";
import {
  api,
  formatApiError,
  roleTemplateLabel,
  type JsonRecord,
} from "@thcpn/api";
import { Badge, PageHeader, Panel, StateView } from "@thcpn/ui";

const value = (input: unknown, fallback = "—") =>
  input === undefined || input === null || input === ""
    ? fallback
    : String(input);
const formatTime = (input: unknown) =>
  input
    ? new Intl.DateTimeFormat("zh-CN", {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(new Date(String(input)))
    : "—";

export function AdminMetadataPage() {
  const [tab, setTab] = useState("capabilities");
  return (
    <>
      <PageHeader
        eyebrow="System / metadata"
        title="元数据"
        description="维护设备能力目录和系统角色显示信息。代码标识保持稳定，名称和状态可安全调整。"
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
            <Input placeholder="例如 遥测数据" />
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
