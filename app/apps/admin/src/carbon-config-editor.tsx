import { useMemo } from "react";
import { Alert, Descriptions, Form, Input, InputNumber, Table, Tabs } from "@thcpn/admin-ui";
import type { FormInstance } from "antd";
import { validateConfigField, type DeviceConfigFields } from "@thcpn/api";
import { carbonControlFields, isCarbonObject, parseCarbonConfigContent, validateCarbonConfig } from "./carbon-config-model";

export function CarbonConfigEditor({ form }: { form: FormInstance<DeviceConfigFields> }) {
  const data = Form.useWatch("data_json", { form, preserve: true }) ?? "[]";
  const image = Form.useWatch("image_json", { form, preserve: true }) ?? "[]";
  const control = Form.useWatch("control_json", { form, preserve: true }) ?? "{}";
  const parsed = useMemo(() => {
    try {
      const draft = parseCarbonConfigContent({ data_json: data, image_json: image, control_json: control });
      return { draft, errors: validateCarbonConfig(draft) };
    } catch (error) { return { draft: null, errors: [error instanceof Error ? error.message : "Carbon 配置 JSON 无效"] }; }
  }, [data, image, control]);
  const sensors = (parsed.draft?.data ?? []).filter(isCarbonObject);
  return <section aria-label="Carbon 配置编辑器">
    <Form.Item name="expected_config_id" hidden><InputNumber /></Form.Item>
    <Alert type="info" showIcon title="Carbon 原生配置"
      description="采集项使用 sensor_id、hardware_interface_type/channel 和 software_interface_type。直接编辑原生 JSON，保留协议参数、未知字段和空的控制计划。" />
    {parsed.errors.length ? <Alert type="error" showIcon title="请修正 Carbon 配置" description={parsed.errors.join("；")} style={{ marginBlock: 12 }} /> : null}
    <Tabs items={[
      { key: "data", label: `采集配置 ${sensors.length}`, forceRender: true, children: <>
        <Table size="small" pagination={false} rowKey={sensor => `${String(sensor.sensor_id)}-${sensors.indexOf(sensor)}`} dataSource={sensors} scroll={{ x: 650 }} columns={[
          { title: "传感器 ID", dataIndex: "sensor_id", width: 110 },
          { title: "说明", dataIndex: "description" },
          { title: "硬件接口", dataIndex: "hardware_interface_type", width: 100 },
          { title: "通道", dataIndex: "hardware_interface_channel", width: 80 },
          { title: "协议", dataIndex: "software_interface_type", width: 120 },
        ]} />
        <Form.Item name="data_json" label="Carbon 采集配置 · data_json" rules={[{ required: true }, { validator: (_, value) => validateConfigField(value, "array") }]} style={{ marginTop: 16 }}>
          <Input.TextArea aria-label="Carbon 采集配置 JSON" rows={18} className="code-input" spellCheck={false} />
        </Form.Item>
      </> },
      { key: "image", label: "图片配置", forceRender: true, children: <Form.Item name="image_json" label="Carbon 图片配置 · image_json" extra="无图片配置时保留 []。" rules={[{ required: true }, { validator: (_, value) => validateConfigField(value, "array") }]}>
        <Input.TextArea aria-label="Carbon 图片配置 JSON" rows={12} className="code-input" spellCheck={false} />
      </Form.Item> },
      { key: "control", label: "控制计划", forceRender: true, children: <>
        <Descriptions size="small" column={{ xs: 1, md: 2 }} items={carbonControlFields.map(({ key, label }) => {
          const value = String(parsed.draft?.control[key] ?? "");
          return { key, label: `${label} · ${key}`, children: value.trim() ? value : "未设置（空白字符串）" };
        })} />
        <Form.Item name="control_json" label="Carbon 控制配置 · control_json" extra="计划格式：分钟列表 小时列表；例如 0 *、50 8,12,16。空字符串可以保留。" rules={[{ required: true }, { validator: (_, value) => validateConfigField(value, "object") }]} style={{ marginTop: 16 }}>
          <Input.TextArea aria-label="Carbon 控制配置 JSON" rows={12} className="code-input" spellCheck={false} />
        </Form.Item>
      </> },
    ]} />
  </section>;
}
