import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ChevronDown,
  ChevronUp,
  Copy,
  Download,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Trash2,
} from "lucide-react";
import {
  Alert,
  Button,
  Drawer,
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
  formatApiError,
  type SensorTemplateRequest,
  type THCPNSensorTemplate,
} from "@thcpn/api";
import { PageHeader, Panel, StateView } from "@thcpn/ui";

type EditorState =
  | { mode: "create"; source?: THCPNSensorTemplate }
  | { mode: "edit"; source: THCPNSensorTemplate }
  | null;

const initialValues = {
  sensor_type: "",
  description: "",
  port: "485",
  port_num: 0,
  driver: "modbusrtu",
  port_nums: [],
  status: "active",
  command: "",
  wait_time: 60,
  metrics: [],
  params_json: '{\n  "command": "",\n  "wait_time": 60,\n  "contents": []\n}',
};

type JsonObject = Record<string, unknown>;

const knownParamKeys = new Set(["command", "wait_time", "contents"]);

function splitParams(params: JsonObject) {
  const extras = Object.fromEntries(
    Object.entries(params).filter(([key]) => !knownParamKeys.has(key)),
  );
  return {
    command: params.command ?? "",
    wait_time: params.wait_time ?? 60,
    metrics: Array.isArray(params.contents) ? params.contents : [],
    extras,
  };
}

function parseParamsJSON(raw: unknown): JsonObject {
  const parsed = JSON.parse(String(raw ?? "{}"));
  if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") {
    throw new Error("params must be an object");
  }
  return parsed as JsonObject;
}

export function AdminSensorsPage() {
  const [page, setPage] = useState(1);
  const [keyword, setKeyword] = useState("");
  const [status, setStatus] = useState<string>();
  const [editor, setEditor] = useState<EditorState>(null);
  const [feedback, setFeedback] = useState("");
  const [busy, setBusy] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [importSource, setImportSource] = useState<string>();
  const [paramsMode, setParamsMode] = useState("visual");
  const [paramExtras, setParamExtras] = useState<JsonObject>({});
  const [form] = Form.useForm();
  const query = useQuery({
    queryKey: ["admin", "sensor-templates", keyword, status, page],
    queryFn: () =>
      api.admin.platformSensorTemplates({
        q: keyword,
        status: status ?? "",
        page,
        page_size: 20,
      }),
  });
  const sources = useQuery({
    queryKey: ["admin", "data-sources", "sensor-import"],
    queryFn: api.admin.sources,
    enabled: importOpen,
  });

  const openEditor = (
    mode: "create" | "edit",
    source?: THCPNSensorTemplate,
  ) => {
    const item = source;
    const params = (item?.params ?? {}) as JsonObject;
    const visual = splitParams(params);
    form.setFieldsValue(
      item
        ? {
            sensor_type: item.sensor_type,
            description: item.description ?? "",
            port: item.port ?? "",
            port_num: item.port_num,
            driver: item.driver ?? "",
            port_nums: item.port_nums.map(String),
            status: item.status,
            command: visual.command,
            wait_time: visual.wait_time,
            metrics: visual.metrics,
            params_json: JSON.stringify(params, null, 2),
          }
        : initialValues,
    );
    setParamExtras(item ? visual.extras : {});
    setParamsMode("visual");
    setEditor(
      mode === "edit" && item
        ? { mode, source: item }
        : { mode: "create", source: item },
    );
    setFeedback("");
  };

  const save = async () => {
    try {
      const values = await form.validateFields();
      let params: Record<string, unknown>;
      if (paramsMode === "json") {
        try {
          params = parseParamsJSON(values.params_json);
        } catch {
          form.setFields([
            { name: "params_json", errors: ["参数必须是有效的 JSON 对象"] },
          ]);
          return;
        }
      } else {
        params = {
          ...paramExtras,
          command: values.command ?? "",
          wait_time: values.wait_time ?? 0,
          contents: values.metrics ?? [],
        };
      }
      const payload: SensorTemplateRequest = {
        sensor_type: values.sensor_type.trim(),
        description: values.description?.trim() ?? "",
        port: values.port?.trim() ?? "",
        port_num: values.port_num ?? 0,
        driver: values.driver?.trim() ?? "",
        port_nums: (values.port_nums ?? [])
          .map((value: string | number) => Number(value))
          .filter(Number.isInteger),
        params,
        status: values.status,
      };
      setBusy(true);
      if (editor?.mode === "edit") {
        await api.admin.updateSensorTemplate(editor.source.id, payload);
      } else {
        await api.admin.createSensorTemplate(payload);
      }
      setEditor(null);
      form.resetFields();
      await query.refetch();
    } catch (error) {
      if ((error as { errorFields?: unknown }).errorFields) return;
      const detail = formatApiError(error);
      setFeedback(
        `${detail.message}${detail.requestId ? ` · request id ${detail.requestId}` : ""}`,
      );
    } finally {
      setBusy(false);
    }
  };

  const changeParamsMode = (nextMode: string) => {
    if (nextMode === paramsMode) return;
    if (nextMode === "json") {
      const values = form.getFieldsValue(true);
      const params = {
        ...paramExtras,
        command: values.command ?? "",
        wait_time: values.wait_time ?? 0,
        contents: values.metrics ?? [],
      };
      form.setFieldValue("params_json", JSON.stringify(params, null, 2));
      form.setFields([{ name: "params_json", errors: [] }]);
      setParamsMode("json");
      return;
    }
    try {
      const params = parseParamsJSON(form.getFieldValue("params_json"));
      const visual = splitParams(params);
      form.setFieldsValue({
        command: visual.command,
        wait_time: visual.wait_time,
        metrics: visual.metrics,
      });
      form.setFields([{ name: "params_json", errors: [] }]);
      setParamExtras(visual.extras);
      setParamsMode("visual");
    } catch {
      form.setFields([
        {
          name: "params_json",
          errors: ["请先修正 JSON，才能切换到可视化编辑"],
        },
      ]);
    }
  };

  const remove = async (id: number) => {
    try {
      await api.admin.deleteSensorTemplate(id);
      await query.refetch();
    } catch (error) {
      const detail = formatApiError(error);
      setFeedback(detail.message);
    }
  };

  const importTemplates = async () => {
    if (!importSource) return;
    setBusy(true);
    try {
      const result = await api.admin.importSensorTemplates(importSource);
      setFeedback(
        `导入 ${result.imported} 个，跳过重复 ${result.skipped} 个，无效 ${result.invalid} 个`,
      );
      setImportOpen(false);
      setImportSource(undefined);
      await query.refetch();
    } catch (error) {
      const detail = formatApiError(error);
      setFeedback(detail.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader
        eyebrow="Assets / sensor templates"
        title="传感器模板"
        description="维护平台统一的传感器协议与指标模板。模板修改只影响后续添加，不会自动改写设备已有配置。"
        actions={<Space>
          <Button icon={<Download size={14} />} onClick={() => setImportOpen(true)}>从数据源导入</Button>
          <Button type="primary" icon={<Plus size={14} />} onClick={() => openEditor("create")}>新增模板</Button>
        </Space>}
      />
      <Panel>
        <div className="admin-list-toolbar">
          <Input
            allowClear
            prefix={<Search size={14} />}
            value={keyword}
            placeholder="搜索型号、说明或驱动"
            onChange={(event) => {
              setKeyword(event.target.value);
              setPage(1);
            }}
          />
          <Select
            allowClear
            value={status}
            placeholder="全部状态"
            options={[
              { value: "active", label: "启用" },
              { value: "disabled", label: "停用" },
            ]}
            onChange={(value) => {
              setStatus(value);
              setPage(1);
            }}
            style={{ width: 140 }}
          />
          <Button
            icon={<RefreshCw size={14} />}
            onClick={() => void query.refetch()}
          >
            刷新
          </Button>
        </div>
        {feedback && (
          <Alert
            type="error"
            showIcon
            message={feedback}
            closable
            onClose={() => setFeedback("")}
          />
        )}
        {query.error ? (
          <StateView
            type="error"
            title="传感器模板加载失败"
            description={formatApiError(query.error).message}
            requestId={formatApiError(query.error).requestId}
          />
        ) : (
          <Table
            rowKey="id"
            size="small"
            loading={query.isLoading}
            dataSource={query.data?.items ?? []}
            pagination={{
              current: page,
              pageSize: 20,
              total: query.data?.total ?? 0,
              showSizeChanger: false,
              showTotal: (total) => `共 ${total} 个模板`,
              onChange: setPage,
            }}
            scroll={{ x: 980 }}
            columns={[
              {
                title: "传感器",
                render: (_, item) => (
                  <div>
                    <strong>{item.sensor_type}</strong>
                    <div className="cell-sub">{item.description || "—"}</div>
                  </div>
                ),
              },
              { title: "驱动", dataIndex: "driver", width: 140 },
              {
                title: "端口",
                width: 120,
                render: (_, item) =>
                  `${item.port || "—"} · ${item.port_num}`,
              },
              {
                title: "可选编号",
                width: 170,
                render: (_, item) =>
                  item.port_nums.length ? item.port_nums.join(", ") : "—",
              },
              {
                title: "指标",
                render: (_, item) => (
                  <Space size={[4, 4]} wrap>
                    {item.metrics.slice(0, 6).map((metric) => (
                      <Tag key={`${item.id}-${metric.key}`}>
                        {metric.name || metric.key}
                      </Tag>
                    ))}
                    {item.metrics.length > 6 && (
                      <Tag>+{item.metrics.length - 6}</Tag>
                    )}
                    {!item.metrics.length && "—"}
                  </Space>
                ),
              },
              {
                title: "状态",
                width: 80,
                render: (_, item) => (
                  <Tag color={item.status === "active" ? "green" : "default"}>
                    {item.status === "active" ? "启用" : "停用"}
                  </Tag>
                ),
              },
              {
                title: "操作",
                width: 210,
                fixed: "right",
                render: (_, item) => (
                  <Space size={2}>
                    <Button
                      type="link"
                      size="small"
                      icon={<Pencil size={13} />}
                      onClick={() => openEditor("edit", item)}
                    >
                      编辑
                    </Button>
                    <Button
                      type="link"
                      size="small"
                      icon={<Copy size={13} />}
                      onClick={() => openEditor("create", item)}
                    >
                      复制
                    </Button>
                    <Popconfirm
                      title="删除传感器模板？"
                      description="已有设备配置不会受影响。"
                      onConfirm={() => void remove(item.id)}
                    >
                      <Button
                        type="link"
                        danger
                        size="small"
                        icon={<Trash2 size={13} />}
                      >
                        删除
                      </Button>
                    </Popconfirm>
                  </Space>
                ),
              },
            ]}
          />
        )}
      </Panel>
      <Drawer
        title={
          editor?.mode === "edit" ? "编辑传感器模板" : "新增传感器模板"
        }
        open={Boolean(editor)}
        width={920}
        onClose={() => setEditor(null)}
        extra={
          <Space>
            <Button onClick={() => setEditor(null)}>取消</Button>
            <Button type="primary" loading={busy} onClick={() => void save()}>
              保存
            </Button>
          </Space>
        }
      >
        <Form form={form} layout="vertical" initialValues={initialValues}>
          <Form.Item
            name="sensor_type"
            label="传感器型号"
            rules={[{ required: true, message: "请输入传感器型号" }]}
          >
            <Input placeholder="例如 HCD6818" />
          </Form.Item>
          <Form.Item name="description" label="说明">
            <Input.TextArea rows={2} />
          </Form.Item>
          <div className="admin-form-grid">
            <Form.Item name="driver" label="驱动 / 协议">
              <Input placeholder="modbusrtu" />
            </Form.Item>
            <Form.Item name="port" label="端口">
              <Input placeholder="485" />
            </Form.Item>
            <Form.Item name="port_num" label="默认端口编号">
              <InputNumber style={{ width: "100%" }} />
            </Form.Item>
            <Form.Item name="status" label="状态">
              <Select
                options={[
                  { value: "active", label: "启用" },
                  { value: "disabled", label: "停用" },
                ]}
              />
            </Form.Item>
          </div>
          <Form.Item
            name="port_nums"
            label="可选端口编号"
            extra="输入编号后回车；设备配置时将从这些编号中选择。"
          >
            <Select mode="tags" tokenSeparators={[",", " "]} />
          </Form.Item>
          <div className="sensor-template-params">
            <div className="visual-subsection-head">
              <div>
                <strong>协议参数与指标</strong>
                <span>可视化编辑常用字段，JSON 模式维护完整原文</span>
              </div>
            </div>
            <Tabs
              activeKey={paramsMode}
              onChange={changeParamsMode}
              items={[
                {
                  key: "visual",
                  label: "可视化编辑",
                  children: (
                    <>
                      <div className="config-form-grid config-form-grid-2">
                        <Form.Item name="command" label="协议命令">
                          <Input className="code-input" />
                        </Form.Item>
                        <Form.Item name="wait_time" label="等待时间">
                          <InputNumber min={0} style={{ width: "100%" }} />
                        </Form.Item>
                      </div>
                      <div className="visual-subsection-head">
                        <div>
                          <strong>数据指标</strong>
                          <span>配置 Key、名称、类型、单位、范围和解码规则</span>
                        </div>
                      </div>
                      <Form.List name="metrics">
                        {(fields, { add, remove, move }) => (
                          <div className="metric-editor-list">
                            {fields.map((field, index) => (
                              <div className="metric-editor-row" key={field.key}>
                                <div className="metric-editor-index">
                                  {index + 1}
                                </div>
                                <div className="metric-editor-fields">
                                  <Form.Item
                                    name={[field.name, "key"]}
                                    label="Key"
                                    rules={[{ required: true, message: "必填" }]}
                                  >
                                    <Input />
                                  </Form.Item>
                                  <Form.Item
                                    name={[field.name, "info", "name"]}
                                    label="名称"
                                  >
                                    <Input />
                                  </Form.Item>
                                  <Form.Item
                                    name={[field.name, "info", "type"]}
                                    label="类型"
                                  >
                                    <Input />
                                  </Form.Item>
                                  <Form.Item
                                    name={[field.name, "info", "unit"]}
                                    label="单位"
                                  >
                                    <Input />
                                  </Form.Item>
                                  <Form.Item
                                    name={[field.name, "info", "index"]}
                                    label="索引"
                                  >
                                    <InputNumber
                                      precision={0}
                                      style={{ width: "100%" }}
                                    />
                                  </Form.Item>
                                  <Form.Item
                                    name={[field.name, "info", "min"]}
                                    label="最小值"
                                  >
                                    <InputNumber style={{ width: "100%" }} />
                                  </Form.Item>
                                  <Form.Item
                                    name={[field.name, "info", "max"]}
                                    label="最大值"
                                  >
                                    <InputNumber style={{ width: "100%" }} />
                                  </Form.Item>
                                  <Form.Item
                                    name={[field.name, "decode"]}
                                    label="Decode"
                                  >
                                    <Input className="code-input" />
                                  </Form.Item>
                                </div>
                                <Space orientation="vertical" size={0}>
                                  <Button
                                    type="text"
                                    icon={<ChevronUp size={13} />}
                                    disabled={index === 0}
                                    onClick={() => move(index, index - 1)}
                                  />
                                  <Button
                                    type="text"
                                    icon={<ChevronDown size={13} />}
                                    disabled={index === fields.length - 1}
                                    onClick={() => move(index, index + 1)}
                                  />
                                  <Button
                                    type="text"
                                    danger
                                    icon={<Trash2 size={13} />}
                                    onClick={() => remove(index)}
                                  />
                                </Space>
                              </div>
                            ))}
                            <Button
                              block
                              type="dashed"
                              icon={<Plus size={14} />}
                              onClick={() =>
                                add({
                                  key: "",
                                  info: {
                                    name: "",
                                    type: "",
                                    unit: "",
                                    index: fields.length,
                                  },
                                  decode: "",
                                })
                              }
                            >
                              添加指标
                            </Button>
                          </div>
                        )}
                      </Form.List>
                      {Object.keys(paramExtras).length > 0 && (
                        <Alert
                          type="info"
                          showIcon
                          message={`已保留 ${Object.keys(paramExtras).length} 个扩展参数`}
                          description="扩展参数不会丢失，可在 JSON 编辑中查看和修改。"
                        />
                      )}
                    </>
                  ),
                },
                {
                  key: "json",
                  label: "JSON 编辑",
                  children: (
                    <Form.Item
                      name="params_json"
                      extra="完整维护 command、wait_time、contents 和其他厂商扩展字段。"
                      rules={[{ required: true, message: "请输入参数 JSON" }]}
                    >
                      <Input.TextArea
                        rows={24}
                        className="mono"
                        spellCheck={false}
                      />
                    </Form.Item>
                  ),
                },
              ]}
            />
          </div>
        </Form>
      </Drawer>
      <Modal
        title="从 THCPN 数据源导入模板"
        open={importOpen}
        okText="开始导入"
        confirmLoading={busy}
        okButtonProps={{ disabled: !importSource }}
        onOk={() => void importTemplates()}
        onCancel={() => setImportOpen(false)}
      >
        <Alert
          type="info"
          showIcon
          message="这是一次显式迁移操作"
          description="读取所选源库的 sensors 表并写入平台模板库。相同型号、端口、驱动和参数的模板会跳过；导入后请在本页面继续维护。"
          style={{ marginBottom: 16 }}
        />
        <Select
          style={{ width: "100%" }}
          loading={sources.isLoading}
          value={importSource}
          placeholder="选择 THCPN 数据源"
          options={((sources.data?.items ?? []) as Array<{ id: string; name: string; status?: string }>).map((source) => ({
            value: source.id,
            label: `${source.name}${source.status === "disabled" ? "（已停用）" : ""}`,
          }))}
          onChange={setImportSource}
        />
      </Modal>
    </>
  );
}
