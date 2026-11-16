import { useState } from "react";
import { Alert, App, Button, Modal, Space, Typography } from "antd";
import { api, formatApiError } from "@thcpn/api";

type ExportScope = { ids: string[]; selected: boolean; includesV2Gateways: boolean };

const fileDate = new Intl.DateTimeFormat("sv-SE", {
  timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit",
});

export function AdminDeviceInventoryExport({ ids, selected, includesV2Gateways, disabled }: ExportScope & { disabled?: boolean }) {
  const { message } = App.useApp();
  const [scope, setScope] = useState<ExportScope>();
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState("");

  async function download() {
    if (!scope || busy) return;
    setBusy(true);
    setFailure("");
    try {
      const blob = await api.admin.downloadDeviceInventory(scope.ids);
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
    <Button disabled={disabled || ids.length === 0} onClick={() => {
      setFailure("");
      setScope({ ids, selected, includesV2Gateways });
    }}>导出设备</Button>
    <Modal title="导出设备" open={Boolean(scope)} okText="下载 Excel" cancelText="取消"
      confirmLoading={busy} closable={!busy} keyboard={!busy} mask={{ closable: false }} cancelButtonProps={{ disabled: busy }}
      onCancel={() => { if (!busy) setScope(undefined); }} onOk={() => void download()}>
      {scope && <Space orientation="vertical" size="middle" style={{ width: "100%" }}>
        <Typography.Text>{scope.selected ? "已勾选设备" : "当前分类和筛选结果"}：<strong>{scope.ids.length} 台</strong>（含其他分页）</Typography.Text>
        {scope.includesV2Gateways && <Typography.Text type="secondary">Excel 附有 LoRaWAN V2 节点清单，可核对节点 SN 和序号。</Typography.Text>}
        {failure && <Alert type="error" title="导出设备失败" description={failure} showIcon />}
      </Space>}
    </Modal>
  </>;
}
