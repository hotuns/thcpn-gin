import { Checkbox, Form, Select, Space, Tag } from "antd";
import type { CheckboxChangeEvent } from "antd/es/checkbox";
import type { PermissionCatalogResponse, PermissionCode } from "../../api";

type PermissionPickerMode = "member" | "grant";

interface PermissionPickerProps {
  catalog?: PermissionCatalogResponse;
  disabled?: boolean;
  mode: PermissionPickerMode;
  onChange: (codes: PermissionCode[]) => void;
  onTemplateChange: (templateCode: string) => void;
  templateCode: string;
  value: PermissionCode[];
}

const internalOnlyPermissions = new Set(["member.manage", "workspace.manage", "audit.view"]);

export function PermissionPicker({ catalog, disabled, mode, onChange, onTemplateChange, templateCode, value }: PermissionPickerProps) {
  const availableCodes = new Set((catalog?.permissions ?? []).filter((permission) => isAllowed(permission.code, mode)).map((permission) => permission.code));
  const selected = value.filter((code) => availableCodes.has(code));
  const templates = (catalog?.templates ?? []).filter((template) => template.permission_codes.some((code) => availableCodes.has(code)));
  const templateOptions = [
    ...templates.map((template) => ({ label: template.name, value: template.code })),
    { label: "自定义权限", value: "custom" }
  ];

  function applyTemplate(nextTemplateCode: string) {
    onTemplateChange(nextTemplateCode);
    if (nextTemplateCode === "custom") {
      return;
    }
    const template = templates.find((item) => item.code === nextTemplateCode);
    if (template) {
      onChange(template.permission_codes.filter((code) => availableCodes.has(code)));
    }
  }

  function toggle(code: string, event: CheckboxChangeEvent) {
    let next: string[];
    if (event.target.checked) {
      next = Array.from(new Set([...selected, code]));
    } else {
      next = selected.filter((item) => item !== code);
    }
    onTemplateChange(matchTemplate(templates, next, availableCodes) || "custom");
    onChange(next);
  }

  return (
    <div className="permission-picker">
      <Form.Item className="field" label="权限模板">
        <Select
          className="control"
          disabled={disabled}
          onChange={applyTemplate}
          options={templateOptions}
          value={templateCode}
        />
      </Form.Item>
      <div className="permission-groups">
        {(catalog?.groups ?? []).map((group) => {
          const permissions = group.codes
            .filter((code) => availableCodes.has(code))
            .map((code) => catalog?.permissions.find((permission) => permission.code === code))
            .filter(Boolean);
          if (permissions.length === 0) {
            return null;
          }
          return (
            <div className="permission-group" key={group.code}>
              <div className="permission-group-title">
                <strong>{group.name}</strong>
                <Tag>{permissions.filter((permission) => selected.includes(permission!.code)).length}</Tag>
              </div>
              <Space className="permission-options" wrap>
                {permissions.map((permission) => (
                  <Checkbox
                    checked={selected.includes(permission!.code)}
                    disabled={disabled}
                    key={permission!.code}
                    onChange={(event) => toggle(permission!.code, event)}
                  >
                    {permission!.name}
                  </Checkbox>
                ))}
              </Space>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function PermissionSummary({ catalog, codes }: { catalog?: PermissionCatalogResponse; codes: PermissionCode[] }) {
  if (!codes.length) {
    return <span>-</span>;
  }
  const names = codes
    .slice(0, 4)
    .map((code) => catalog?.permissions.find((permission) => permission.code === code)?.name || code)
    .join("、");
  const suffix = codes.length > 4 ? ` +${codes.length - 4}` : "";
  return <span>{names}{suffix}</span>;
}

function isAllowed(code: string, mode: PermissionPickerMode) {
  if (mode === "member") {
    return true;
  }
  return !internalOnlyPermissions.has(code);
}

function matchTemplate(templates: PermissionCatalogResponse["templates"], codes: string[], availableCodes: Set<string>) {
  const normalized = normalizeCodes(codes);
  return templates.find((template) => normalizeCodes(template.permission_codes.filter((code) => availableCodes.has(code))) === normalized)?.code;
}

function normalizeCodes(codes: string[]) {
  return [...new Set(codes)].sort().join("\n");
}
