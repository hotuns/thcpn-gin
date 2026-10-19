import { configFieldsFromDetail, parseDeviceConfig, type JsonRecord } from "@thcpn/api";

export {
  configFieldsFromDetail,
  parseDeviceConfig,
  validateConfigField,
  type DeviceConfigFields,
} from "@thcpn/api";

// Only editable content is copied. The target form keeps its own version token.
export function copiedDeviceConfigFields(detail: JsonRecord) {
  const fields = configFieldsFromDetail(detail);
  parseDeviceConfig(fields);
  return { data_json: fields.data_json, image_json: fields.image_json, control_json: fields.control_json };
}
