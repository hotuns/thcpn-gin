import { useState } from "react";
import { useLocale } from "@thcpn/i18n";
import { Button, CheckboxInput, SearchInput, type PickerOption } from "./platform-ui";
import { RadioGroup, RadioGroupItem } from "./components/ui/radio-group";

/** Export choices are live form values, not a second confirm/commit workflow. */
export function ExportDevicePicker({ label, options, selectedIds, onChange, mode = "single", searchPlaceholder }: {
  label: string; options: PickerOption[]; selectedIds: string[];
  onChange: (ids: string[]) => void; mode?: "single" | "multiple"; searchPlaceholder?: string;
}) {
  const { t } = useLocale();
  const [keyword, setKeyword] = useState("");
  const filtered = options.filter(item => `${item.label} ${item.description ?? ""} ${item.searchText ?? ""}`.toLowerCase().includes(keyword.trim().toLowerCase()));
  const selected = options.filter(item => selectedIds.includes(item.id));
  const choose = (id: string) => onChange(mode === "single" ? [id] : selectedIds.includes(id) ? selectedIds.filter(value => value !== id) : [...selectedIds, id]);
  const choices = <>{filtered.map(item => {
    const checked = selectedIds.includes(item.id);
    const content = <span><strong>{item.label}</strong>{item.description && <small>{item.description}</small>}</span>;
    return <label key={item.id} className={checked ? "is-selected" : ""}>
      {mode === "multiple" ? <CheckboxInput checked={checked} onChange={() => choose(item.id)} /> : <RadioGroupItem value={item.id} />}{content}
    </label>;
  })}{!filtered.length && <p className="data-builder-empty" role="status">{t(options.length ? "exportEditor.noMatch" : "exportEditor.noDevices")}</p>}</>;
  return <fieldset className="export-device-picker">
    <legend>{label}</legend>
    {(options.length > 5 || keyword) && <SearchInput aria-label={searchPlaceholder ?? label} placeholder={searchPlaceholder ?? label} value={keyword} onChange={event => setKeyword(event.target.value)} />}
    {mode === "multiple" && <div className="export-device-picker-toolbar">
      <span aria-live="polite">{t("exportEditor.selected", { count: selected.length })}</span>
      {options.length > 1 && <div>
        <Button type="button" variant="ghost" disabled={!filtered.length} onClick={() => onChange([...new Set([...selectedIds, ...filtered.map(item => item.id)])])}>{t("exportEditor.selectAll")}</Button>
        <Button type="button" variant="ghost" disabled={!selected.length} onClick={() => onChange([])}>{t("exportEditor.clear")}</Button>
      </div>}
    </div>}
    {mode === "single" ? <RadioGroup value={selectedIds[0] ?? ""} onValueChange={id => onChange([id])} className="export-device-picker-list" aria-label={label}>{choices}</RadioGroup> : <div className="export-device-picker-list">{choices}</div>}
  </fieldset>;
}

export function ExportContentToggle({ checked, onChange, title, description, disabled = false }: {
  checked: boolean; onChange: (value: boolean) => void; title: string; description?: string; disabled?: boolean;
}) {
  return <label className="export-content-toggle"><CheckboxInput checked={checked} disabled={disabled} onChange={event => onChange(event.target.checked)} /><span><strong>{title}</strong>{description && <small>{description}</small>}</span></label>;
}

export function ExportContents({ data, images, setData, setImages, imagesAvailable = true }: {
  data: boolean; images: boolean; setData: (value: boolean) => void; setImages: (value: boolean) => void; imagesAvailable?: boolean;
}) {
  const { t } = useLocale();
  return <fieldset className="export-content-options"><legend>{t("exportEditor.content")}</legend>
    <ExportContentToggle checked={data} onChange={setData} title={t("exportEditor.dataOnly")} description={t("exportEditor.dataDescription")} />
    <ExportContentToggle checked={images} onChange={setImages} disabled={!imagesAvailable} title={t("exportEditor.imagesOnly")} description={t(imagesAvailable ? "exportEditor.imageDescription" : "exportEditor.imagesUnavailable")} />
    {!data && !images && <p className="data-builder-validation" role="alert">{t("exportEditor.chooseContent")}</p>}
  </fieldset>;
}
