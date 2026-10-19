import type { DeviceConfigFields, JsonRecord } from "@thcpn/api";
import { prepareTHCPNConfigSave } from "./thcpn-config-model";
import { prepareCarbonConfigSave } from "./carbon-config-model";
import type { ConfigSaveReview } from "./config-save-types";
export type { ConfigSaveReview } from "./config-save-types";

const preparers: Record<string, (fields: DeviceConfigFields, original: JsonRecord) => ConfigSaveReview> = {
  thcpn: prepareTHCPNConfigSave,
  carbon: prepareCarbonConfigSave,
};

export function prepareDeviceConfigSave(sourceFamily: string, fields: DeviceConfigFields, original: JsonRecord): ConfigSaveReview {
  const prepare = preparers[sourceFamily];
  if (!prepare) throw new Error("该数据源不支持此配置编辑方式");
  return prepare(fields, original);
}
