import { Alert, Button, Form, Input, InputNumber, Select, Space } from '@thcpn/admin-ui';
import { ChevronUp, ChevronDown, Trash2, Plus } from 'lucide-react';
type JsonObject = Record<string, unknown>;
export type LoRaVisualItem = {
  kind: "ad" | "485" | "sdi" | "iic";
  port?: number;
  command?: string;
  address?: string;
  model?: string;
  mappings?: Array<{
    info?: JsonObject;
    key?: string;
    rule?: string;
    unit?: string;
    index?: string;
  }>;
};

export function splitLoRaContent(content: unknown): LoRaVisualItem[] {
  if (!Array.isArray(content)) return [];
  return content.flatMap<LoRaVisualItem>((raw) => {
    if (!Array.isArray(raw) || typeof raw[0] !== "string") return [];
    const kind = raw[0] as LoRaVisualItem["kind"];
    const inner = Array.isArray(raw[1]) ? raw[1] : [];
    if (kind === "ad")
      return [
        {
          kind,
          port: Number(raw[2] ?? 0),
          mappings: (Array.isArray(raw[1]) ? raw[1] : []).map((item) => ({
            key: item?.[0],
            rule: item?.[1],
            unit: item?.[2],
          })),
        },
      ];
    if (kind === "485")
      return [
        {
          kind,
          command: String(inner[0] ?? ""),
          mappings: (Array.isArray(inner[1]) ? inner[1] : []).map((item) => ({
            key: item?.[0],
            rule: item?.[1],
            unit: item?.[2],
          })),
        },
      ];
    if (kind === "sdi")
      return [
        {
          kind,
          address: String(inner[0] ?? ""),
          mappings: (Array.isArray(inner[1]) ? inner[1] : []).map((item) => ({
            key: item?.[0],
            index: String(item?.[1] ?? ""),
          })),
        },
      ];
    if (kind === "iic")
      return [
        {
          kind,
          model: String(inner[0] ?? ""),
          address: String(inner[1] ?? ""),
          mappings: (Array.isArray(inner[2]) ? inner[2] : []).map((key) => ({
            key: String(key),
          })),
        },
      ];
    return [];
  });
}

export function attachMetricInfo(items: LoRaVisualItem[], metrics: JsonObject[]): LoRaVisualItem[] {
  return items.map(item => ({ ...item, mappings: item.mappings?.map(mapping => {
    const metric = metrics.find(metric => metric.key === mapping.key);
    return { ...mapping, info: { ...((metric?.info ?? {}) as JsonObject), unit: mapping.unit ?? (metric?.info as JsonObject)?.unit ?? "" } };
  }) }));
}

export function collectMetricInfo(items: LoRaVisualItem[]): JsonObject[] {
  return items.flatMap(item => (item.mappings ?? []).map(mapping => ({
    key: mapping.key,
    info: { ...mapping.info, unit: mapping.info?.unit ?? "" },
  })));
}

export function buildLoRaContent(items: LoRaVisualItem[]): unknown[] {
  return (items ?? []).map((item) => {
    const mappings = item.mappings ?? [];
    if (item.kind === "ad")
      return [
        "ad",
        mappings.map((entry) => [entry.key, entry.rule, entry.info?.unit ?? entry.unit ?? ""]),
        Number(item.port ?? 0),
      ];
    if (item.kind === "485")
      return [
        "485",
        [
          item.command ?? "",
          mappings.map((entry) => [entry.key, entry.rule, entry.info?.unit ?? entry.unit ?? ""]),
        ],
      ];
    if (item.kind === "sdi")
      return [
        "sdi",
        [
          item.address ?? "",
          mappings.map((entry) => [entry.key, entry.index ?? ""]),
        ],
      ];
    return [
      "iic",
      [
        item.model ?? "",
        item.address ?? "",
        mappings.map((entry) => entry.key),
      ],
    ];
  });
}


export function LoRaProtocolFields() { return (<Form.Item noStyle shouldUpdate>
                                  {({ getFieldValue }) => {
                                    return (
                                      <Form.List name="lora_items">
                                        {(fields, { add, remove, move }) => (
                                          <div className="lora-protocol-list">
                                            {fields.map((field, index) => {
                                              const kind = getFieldValue([
                                                "lora_items",
                                                field.name,
                                                "kind",
                                              ]) as LoRaVisualItem["kind"];
                                              return (
                                                <div
                                                  className="lora-protocol-item"
                                                  key={field.key}
                                                >
                                                  <div className="lora-protocol-item-head">
                                                    <strong>
                                                      协议项 {index + 1}
                                                    </strong>
                                                    <Space size={2}>
                                                      <Button
                                                        type="text"
                                                        icon={
                                                          <ChevronUp
                                                            size={13}
                                                          />
                                                        }
                                                        disabled={index === 0}
                                                        onClick={() =>
                                                          move(index, index - 1)
                                                        }
                                                      />
                                                      <Button
                                                        type="text"
                                                        icon={
                                                          <ChevronDown
                                                            size={13}
                                                          />
                                                        }
                                                        disabled={
                                                          index ===
                                                          fields.length - 1
                                                        }
                                                        onClick={() =>
                                                          move(index, index + 1)
                                                        }
                                                      />
                                                      <Button
                                                        type="text"
                                                        danger
                                                        icon={
                                                          <Trash2 size={13} />
                                                        }
                                                        onClick={() =>
                                                          remove(index)
                                                        }
                                                      />
                                                    </Space>
                                                  </div>
                                                  <div className="config-form-grid config-form-grid-3">
                                                    <Form.Item
                                                      name={[
                                                        field.name,
                                                        "kind",
                                                      ]}
                                                      label="协议类型"
                                                      rules={[
                                                        {
                                                          required: true,
                                                          message: "请选择协议",
                                                        },
                                                      ]}
                                                    >
                                                      <Select
                                                        options={[
                                                          {
                                                            value: "ad",
                                                            label: "AD 模拟量",
                                                          },
                                                          {
                                                            value: "485",
                                                            label: "RS-485",
                                                          },
                                                          {
                                                            value: "sdi",
                                                            label: "SDI-12",
                                                          },
                                                          {
                                                            value: "iic",
                                                            label: "IIC",
                                                          },
                                                        ]}
                                                      />
                                                    </Form.Item>
                                                    {kind === "ad" ? (
                                                      <Form.Item
                                                        name={[
                                                          field.name,
                                                          "port",
                                                        ]}
                                                        label="AD 端口"
                                                        rules={[
                                                          {
                                                            required: true,
                                                            message:
                                                              "请输入端口",
                                                          },
                                                        ]}
                                                      >
                                                        <InputNumber
                                                          min={0}
                                                          precision={0}
                                                          style={{
                                                            width: "100%",
                                                          }}
                                                        />
                                                      </Form.Item>
                                                    ) : null}
                                                    {kind === "485" ? (
                                                      <Form.Item
                                                        name={[
                                                          field.name,
                                                          "command",
                                                        ]}
                                                        label="请求命令"
                                                        rules={[
                                                          {
                                                            required: true,
                                                            message:
                                                              "请输入命令",
                                                          },
                                                        ]}
                                                      >
                                                        <Input className="code-input" />
                                                      </Form.Item>
                                                    ) : null}
                                                    {kind === "sdi" ? (
                                                      <Form.Item
                                                        name={[
                                                          field.name,
                                                          "address",
                                                        ]}
                                                        label="SDI 地址"
                                                        rules={[
                                                          {
                                                            required: true,
                                                            message:
                                                              "请输入地址",
                                                          },
                                                        ]}
                                                      >
                                                        <Input />
                                                      </Form.Item>
                                                    ) : null}
                                                    {kind === "iic" ? (
                                                      <>
                                                        <Form.Item
                                                          name={[
                                                            field.name,
                                                            "model",
                                                          ]}
                                                          label="IIC 型号"
                                                          rules={[
                                                            {
                                                              required: true,
                                                              message:
                                                                "请输入型号",
                                                            },
                                                          ]}
                                                        >
                                                          <Input />
                                                        </Form.Item>
                                                        <Form.Item
                                                          name={[
                                                            field.name,
                                                            "address",
                                                          ]}
                                                          label="IIC 地址"
                                                          rules={[
                                                            {
                                                              required: true,
                                                              message:
                                                                "请输入地址",
                                                            },
                                                          ]}
                                                        >
                                                          <Input placeholder="例如 0x44" />
                                                        </Form.Item>
                                                      </>
                                                    ) : null}
                                                  </div>
                                                  {kind ? (
                                                    <Form.List
                                                      name={[
                                                        field.name,
                                                        "mappings",
                                                      ]}
                                                    >
                                                      {(
                                                        mappingFields,
                                                        actions,
                                                      ) => (
                                                        <div className="lora-mapping-list">
                                                          {mappingFields.map(
                                                            (mapping) => (
                                                              <div
                                                                className="lora-template-metric-row"
                                                                key={
                                                                  mapping.key
                                                                }
                                                              >
                                                                <Form.Item
                                                                  name={[
                                                                    mapping.name,
                                                                    "key",
                                                                  ]}
                                                                  label="Key"
                                                                  rules={[{ required: true, message: "请输入 Key" }]}
                                                                >
                                                                  <Input />
                                                                </Form.Item>
                                                                <Form.Item name={[mapping.name, "info", "name"]} label="名称" rules={[{ required: true, message: "请输入名称" }]}><Input /></Form.Item>
                                                                <Form.Item name={[mapping.name, "info", "type"]} label="类型"><Input /></Form.Item>
                                                                <Form.Item name={[mapping.name, "info", "unit"]} label="单位"><Input /></Form.Item>
                                                                <Form.Item name={[mapping.name, "info", "min"]} label="最小值"><InputNumber style={{ width: "100%" }} /></Form.Item>
                                                                <Form.Item name={[mapping.name, "info", "max"]} label="最大值"><InputNumber style={{ width: "100%" }} /></Form.Item>
                                                                {kind ===
                                                                  "ad" ||
                                                                kind ===
                                                                  "485" ? (
                                                                  <>
                                                                    <Form.Item
                                                                      name={[
                                                                        mapping.name,
                                                                        "rule",
                                                                      ]}
                                                                      label="解析规则"
                                                                      rules={[
                                                                        {
                                                                          required: true,
                                                                          message:
                                                                            "请输入规则",
                                                                        },
                                                                      ]}
                                                                    >
                                                                      <Input className="code-input" />
                                                                    </Form.Item>

                                                                  </>
                                                                ) : null}
                                                                {kind ===
                                                                "sdi" ? (
                                                                  <Form.Item
                                                                    name={[
                                                                      mapping.name,
                                                                      "index",
                                                                    ]}
                                                                    label="返回索引"
                                                                    rules={[
                                                                      {
                                                                        required: true,
                                                                        message:
                                                                          "请输入索引",
                                                                      },
                                                                    ]}
                                                                  >
                                                                    <Input />
                                                                  </Form.Item>
                                                                ) : null}
                                                                <Button
                                                                  type="text"
                                                                  danger
                                                                  icon={
                                                                    <Trash2
                                                                      size={13}
                                                                    />
                                                                  }
                                                                  onClick={() =>
                                                                    actions.remove(
                                                                      mapping.name,
                                                                    )
                                                                  }
                                                                />
                                                              </div>
                                                            ),
                                                          )}
                                                          <Button
                                                            type="dashed"
                                                            block
                                                            onClick={() =>
                                                              actions.add({
                                                                key: "",
                                                                rule: "",
                                                                info: { name: "", type: "", unit: "" },
                                                                index: "",
                                                              })
                                                            }
                                                          >
                                                            添加指标
                                                          </Button>
                                                        </div>
                                                      )}
                                                    </Form.List>
                                                  ) : (
                                                    <Alert
                                                      type="info"
                                                      message="请先选择协议类型"
                                                    />
                                                  )}
                                                </div>
                                              );
                                            })}
                                            <Button
                                              type="dashed"
                                              block
                                              icon={<Plus size={14} />}
                                              onClick={() =>
                                                add({
                                                  kind: "485",
                                                  command: "",
                                                  mappings: [],
                                                })
                                              }
                                            >
                                              添加协议项
                                            </Button>
                                          </div>
                                        )}
                                      </Form.List>
                                    );
                                  }}
                                </Form.Item>); }
