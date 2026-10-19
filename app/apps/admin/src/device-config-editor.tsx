import type { ComponentType } from "react";
import { Alert } from "@thcpn/admin-ui";
import type { FormInstance } from "antd";
import { THCPNVisualConfigEditor } from "./thcpn-config-editor";
import { CarbonConfigEditor } from "./carbon-config-editor";

type Props = { deviceId: string; form: FormInstance<any> };
const editors: Record<string, ComponentType<Props>> = { thcpn: THCPNVisualConfigEditor, carbon: CarbonConfigEditor };

export function DeviceConfigEditor({ sourceFamily, ...props }: Props & { sourceFamily: string }) {
  const Editor = editors[sourceFamily];
  return Editor ? <Editor {...props} /> : <Alert type="error" title="该数据源不支持此配置编辑方式" showIcon />;
}
