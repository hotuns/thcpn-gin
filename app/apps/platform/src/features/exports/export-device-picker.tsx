import { useLocale } from "@thcpn/i18n";
import { CheckboxInput } from "../../shared/ui";
import { DeviceCombobox, type DeviceOption } from "../../shared/data/device-combobox";

export function ExportDevicePicker({ label, devices, selectedIds, onChange, mode = "single", searchPlaceholder }: {
  label: string; devices: DeviceOption[]; selectedIds: string[];
  onChange: (ids: string[]) => void; mode?: "single" | "multiple"; searchPlaceholder?: string;
}) {
  return <fieldset className="export-device-picker">
    <legend>{label}</legend>
    <DeviceCombobox
      devices={devices}
      variant="inline"
      ariaLabel={`选择${label}`}
      searchPlaceholder={searchPlaceholder}
      {...(mode === "multiple"
        ? { multiple: true, value: selectedIds, onChange }
        : { value: selectedIds[0] ?? "", onChange: (id: string) => onChange([id]) })}
    />
  </fieldset>;
}

export function ExportContentToggle({ checked, onChange, title, description, disabled = false }: {
  checked: boolean; onChange: (value: boolean) => void; title: string; description?: string; disabled?: boolean;
}) {
  return <label className="export-content-toggle"><CheckboxInput checked={checked} disabled={disabled} onChange={event => onChange(event.target.checked)} /><span><strong>{title}</strong>{description && <small>{description}</small>}</span></label>;
}

export function ExportContents({ data, images, setData, setImages, imagesAvailable = true, status, setStatus }: {
  data: boolean; images: boolean; setData: (value: boolean) => void; setImages: (value: boolean) => void; imagesAvailable?: boolean; status?: boolean; setStatus?: (value:boolean)=>void;
}) {
  const { t } = useLocale();
  return <fieldset className="export-content-options"><legend>{t("exportEditor.content")}</legend>
    <ExportContentToggle checked={data} onChange={setData} title={setStatus ? "采集数据" : t("exportEditor.dataOnly")} description={setStatus ? undefined : t("exportEditor.dataDescription")} />
    <ExportContentToggle checked={images} onChange={setImages} disabled={!imagesAvailable} title={t("exportEditor.imagesOnly")} description={t(imagesAvailable ? "exportEditor.imageDescription" : "exportEditor.imagesUnavailable")} />
    {setStatus && <ExportContentToggle checked={!!status} onChange={setStatus} title="运行状态"/>}
    {!data && !images && !status && <p className="data-builder-validation" role="alert">{t("exportEditor.chooseContent")}</p>}
  </fieldset>;
}
