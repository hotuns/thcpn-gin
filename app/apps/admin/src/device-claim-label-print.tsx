import { useRef, useState, type CSSProperties } from "react";
import { App, Form, InputNumber, Modal, Space, Typography } from "antd";
import { QRCodeSVG } from "qrcode.react";
import { formatApiError } from "@thcpn/api";
import labelStyles from "./device-claim-label-print.css?inline";

type Props = {
  open: boolean;
  onClose: () => void;
  claimUrl: string;
  assetNo: string;
  manualCode: string;
  onPrinted: () => Promise<void>;
};

export function DeviceClaimLabelPrint({ open, onClose, claimUrl, assetNo, manualCode, onPrinted }: Props) {
  const { message } = App.useApp();
  const [width, setWidth] = useState<number | null>(30);
  const [printing, setPrinting] = useState(false);
  const labelRef = useRef<HTMLElement>(null);
  const validWidth = width !== null && Number.isFinite(width) && width > 0;
  const labelWidth = validWidth ? width : 30;
  const labelHeight = Number((labelWidth * 4 / 3).toFixed(2));
  const dimensions = {
    "--claim-label-width": `${labelWidth}mm`,
    "--claim-label-height": `${labelHeight}mm`,
    "--claim-label-unit": `${labelWidth / 30}mm`,
  } as CSSProperties;

  const print = async () => {
    if (!validWidth || !claimUrl || !assetNo || !manualCode || !labelRef.current) return;
    const popup = window.open("", "_blank", "width=520,height=720");
    if (!popup) {
      void message.error("打印窗口被浏览器拦截，请允许弹出窗口后重试");
      return;
    }
    setPrinting(true);
    try {
      const doc = popup.document;
      doc.title = "扫码绑定设备";
      doc.documentElement.lang = "zh-CN";
      const style = doc.createElement("style");
      // Explicit physical paper size is independent of the popup's screen size.
      style.textContent = `${labelStyles}\n@page { size: ${labelWidth}mm ${labelHeight}mm; margin: 0; }
        html, body { margin: 0; padding: 0; width: ${labelWidth}mm; background: #fff; }
        @media print { html, body { height: ${labelHeight}mm; } }`;
      doc.head.appendChild(style);
      // Clone the React-rendered label so SN and code remain text, not HTML.
      doc.body.replaceChildren(doc.importNode(labelRef.current, true));
      popup.focus();
      await doc.fonts.ready;
      await new Promise<void>(resolve => popup.requestAnimationFrame(() => resolve()));
      popup.print();
    } catch (error) {
      void message.error(`无法打开打印：${formatApiError(error).message}`);
      setPrinting(false);
      return;
    }
    try {
      await onPrinted();
    } catch (error) {
      void message.warning(`打印记录保存失败：${formatApiError(error).message}`);
    } finally {
      setPrinting(false);
    }
  };

  return <Modal open={open} title="打印绑定标签" onCancel={() => !printing && onClose()}
    onOk={() => void print()} okText="打印" cancelText="关闭" confirmLoading={printing}
    okButtonProps={{ disabled: !validWidth || !claimUrl || !assetNo || !manualCode }} width={440}>
    <style>{labelStyles}</style>
    <Form layout="vertical">
      <Form.Item label="标签尺寸（宽 × 高）">
        <Space wrap>
          <InputNumber value={width} onChange={setWidth} min={1} step={3} precision={1}
            suffix="mm" disabled={printing} aria-label="标签宽度（毫米）" />
          <Typography.Text>× {labelHeight} mm · 3:4 竖版</Typography.Text>
        </Space>
      </Form.Item>
    </Form>
    <div className="claim-label-preview">
      <div className="claim-label-preview-canvas" style={dimensions}>
        <article className="claim-label" style={dimensions} ref={labelRef} aria-label="绑定标签预览">
          <h1>扫码绑定设备</h1>
          <div className="claim-label-qr"><QRCodeSVG value={claimUrl} size={256} level="M" marginSize={4} /></div>
          <div className="claim-label-details">
            <div className="claim-label-sn">资产编号 {assetNo}</div>
            <div className="claim-label-code">绑定码 {manualCode}</div>
          </div>
        </article>
      </div>
    </div>
    <Typography.Paragraph type="secondary" style={{ marginTop: 16, marginBottom: 0 }}>
      打印机纸张选择 {labelWidth} × {labelHeight} mm，缩放设为 100%，关闭页眉和页脚。
    </Typography.Paragraph>
  </Modal>;
}
