import { useState } from "react";
import { Alert, App, Button, Checkbox, Divider, Flex, Modal, Space, Typography } from "antd";
import { api, formatApiError, type InventoryDeviceField, type InventoryNodeField } from "@thcpn/api";

type ExportScope = { ids: string[]; selected: boolean; includesGateways: boolean; includesV2Gateways: boolean };
type FieldOption<T extends string> = { value: T; label: string };

const defaultDeviceFields: InventoryDeviceField[] = [
  "asset_no", "name", "device_type", "hardware_sn", "collection_id", "lifecycle_status", "status", "workspace", "project", "site",
];

const deviceFieldGroups: { title: string; fields: FieldOption<InventoryDeviceField>[] }[] = [
  { title: "基本信息", fields: [
    { value: "asset_no", label: "资产编号" }, { value: "name", label: "设备名称" },
    { value: "device_type", label: "设备类型" }, { value: "hardware_sn", label: "硬件 SN" },
    { value: "collection_id", label: "采集设备标识" }, { value: "gateway_sn", label: "网关 SN（LoRaWAN V2）" },
    { value: "iccid", label: "登记 ICCID" }, { value: "ops_tags", label: "运维标签" },
  ] },
  { title: "状态和归属", fields: [
    { value: "lifecycle_status", label: "生命周期" }, { value: "status", label: "资产状态" },
    { value: "workspace", label: "工作区" }, { value: "project", label: "项目" }, { value: "site", label: "站点" },
  ] },
  { title: "安装与交付", fields: [
    { value: "address", label: "安装地址" }, { value: "installed_on", label: "安装日期" }, { value: "installer", label: "安装人" },
    { value: "customer_org", label: "所属单位" }, { value: "delivery_project", label: "交付项目名称" },
    { value: "contact_name", label: "联系人" }, { value: "contact_phone", label: "联系电话" },
  ] },
];

const nodeFieldOptions: FieldOption<InventoryNodeField>[] = [
  { value: "gateway_asset_no", label: "网关资产编号" }, { value: "gateway_name", label: "网关名称" },
  { value: "gateway_sn", label: "网关 SN" }, { value: "asset_no", label: "节点资产编号" },
  { value: "name", label: "节点名称" }, { value: "node_sn", label: "节点 SN" }, { value: "node_index", label: "节点序号" },
];

const defaultNodeFields = nodeFieldOptions.map(option => option.value);
const fieldGrid = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: "8px 12px", width: "100%" };

const fileDate = new Intl.DateTimeFormat("sv-SE", {
  timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit",
});

function FieldActions({ allSelected, canClear, onSelectAll, onClear, busy }: {
  allSelected: boolean;
  canClear: boolean;
  onSelectAll: () => void;
  onClear: () => void;
  busy: boolean;
}) {
  return <Space size={4}>
    <Button type="link" size="small" disabled={busy || allSelected} onClick={onSelectAll}>全选</Button>
    <Button type="link" size="small" disabled={busy || !canClear} onClick={onClear}>清空</Button>
  </Space>;
}

export function AdminDeviceInventoryExport({ ids, selected, includesGateways, includesV2Gateways, disabled }: ExportScope & { disabled?: boolean }) {
  const { message } = App.useApp();
  const [scope, setScope] = useState<ExportScope>();
  const [deviceFields, setDeviceFields] = useState<InventoryDeviceField[]>(defaultDeviceFields);
  const [nodeFields, setNodeFields] = useState<InventoryNodeField[]>(defaultNodeFields);
  const [includeBindingCode, setIncludeBindingCode] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState("");
  const visibleDeviceGroups = deviceFieldGroups.map(group => ({
    ...group,
    fields: group.fields.filter(field => field.value !== "gateway_sn" || scope?.includesV2Gateways),
  }));
  const regularFields = visibleDeviceGroups.flatMap(group => group.fields.map(field => field.value));
  const exportFields: InventoryDeviceField[] = includeBindingCode ? [...deviceFields, "binding_code"] : deviceFields;

  function open() {
    setFailure("");
    setDeviceFields(defaultDeviceFields);
    setNodeFields(defaultNodeFields);
    setIncludeBindingCode(false);
    setScope({ ids, selected, includesGateways, includesV2Gateways });
  }

  async function download() {
    if (!scope || busy || !exportFields.length) return;
    setBusy(true);
    setFailure("");
    try {
      const blob = await api.admin.downloadDeviceInventory(scope.ids, {
        fields: exportFields,
        node_fields: scope.includesGateways ? nodeFields : [],
      });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `设备清单_${fileDate.format(new Date())}.xlsx`;
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 0);
      setScope(undefined);
      void message.success("设备清单已开始下载");
    } catch (error) {
      setFailure(formatApiError(error).message);
    } finally {
      setBusy(false);
    }
  }

  return <>
    <Button disabled={disabled || ids.length === 0} onClick={open}>导出设备</Button>
    <Modal title="导出设备" open={Boolean(scope)} width={640} okText="下载 Excel" cancelText="取消"
      okButtonProps={{ disabled: !exportFields.length }} styles={{ body: { maxHeight: "68vh", overflowY: "auto" } }}
      confirmLoading={busy} closable={!busy} keyboard={!busy} mask={{ closable: false }} cancelButtonProps={{ disabled: busy }}
      onCancel={() => { if (!busy) setScope(undefined); }} onOk={() => void download()}>
      {scope && <Space orientation="vertical" size="middle" style={{ width: "100%" }}>
        <Typography.Text>{scope.selected ? "已勾选设备" : "当前分类和筛选结果"}：<strong>{scope.ids.length} 台</strong>（含其他分页）</Typography.Text>
        <section aria-label="设备清单字段">
          <Flex align="center" justify="space-between" gap={12} wrap>
            <Typography.Text strong>设备清单字段</Typography.Text>
            <FieldActions allSelected={deviceFields.length === regularFields.length} canClear={!!exportFields.length} busy={busy}
              onSelectAll={() => setDeviceFields(regularFields)} onClear={() => { setDeviceFields([]); setIncludeBindingCode(false); }} />
          </Flex>
          <Checkbox.Group<InventoryDeviceField> value={deviceFields} onChange={setDeviceFields} disabled={busy} style={{ display: "block" }}>
            {visibleDeviceGroups.map(group => <div role="group" aria-label={group.title} key={group.title} style={{ marginTop: 12 }}>
              <Typography.Text type="secondary">{group.title}</Typography.Text>
              <div style={{ ...fieldGrid, marginTop: 6 }}>{group.fields.map(field => <Checkbox key={field.value} value={field.value}>{field.label}</Checkbox>)}</div>
            </div>)}
          </Checkbox.Group>
          <Divider style={{ marginBlock: 12 }} />
          <Checkbox checked={includeBindingCode} disabled={busy} onChange={event => setIncludeBindingCode(event.target.checked)}>设备绑定码</Checkbox>
          {includeBindingCode && <Alert type="warning" showIcon style={{ marginTop: 8 }} title="绑定码可用于认领设备"
            description="只导出已有的绑定码，未生成的留空。请妥善保管下载的文件。" />}
          {!exportFields.length && <div><Typography.Text type="secondary">请至少选择一个设备清单字段。</Typography.Text></div>}
        </section>
        {scope.includesGateways && <section aria-label="网关节点字段">
          <Divider style={{ marginTop: 0, marginBottom: 8 }} />
          <Flex align="center" justify="space-between" gap={12} wrap>
            <Typography.Text strong>网关节点字段</Typography.Text>
            <FieldActions allSelected={nodeFields.length === defaultNodeFields.length} canClear={!!nodeFields.length} busy={busy}
              onSelectAll={() => setNodeFields(defaultNodeFields)} onClear={() => setNodeFields([])} />
          </Flex>
          <Checkbox.Group<InventoryNodeField> options={nodeFieldOptions} value={nodeFields} onChange={setNodeFields} disabled={busy} style={fieldGrid} />
          {!nodeFields.length && <Typography.Text type="secondary">本次 Excel 不含网关节点工作表。</Typography.Text>}
        </section>}
        {failure && <Alert type="error" title="导出设备失败" description={failure} showIcon />}
      </Space>}
    </Modal>
  </>;
}
