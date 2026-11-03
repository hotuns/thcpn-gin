import { useState, type FormEvent } from "react";
import { type JsonRecord } from "@thcpn/api";
import { DataRangeFields as RangeFields, validDataRange } from "../../shared/data/data-builder";
import { ExportDevicePicker, ExportContents } from "./export-device-picker";
import { defaultRange, value, pickerOptions, arrayParam, buildBatchExportPayload } from "./export-model";
import { type FormCommon, FormFooter } from "./export-form-layout";

export function StandardExportForm({
  devices,
  params,
  chooser,
  onClose,
  onCreate,
  feedback,
}: { devices: JsonRecord[] } & FormCommon) {
  const list = devices.filter(
    (item) => value(item, "device_type") === "standalone",
  );
  const initial = arrayParam(params.get("devices"));
  const range = defaultRange();
  const [selected, setSelected] = useState<string[]>(initial);
  const [start, setStart] = useState(params.get("start") ?? range.start);
  const [end, setEnd] = useState(params.get("end") ?? range.end);
  const [images, setImages] = useState(true);
  const [data, setData] = useState(true);
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy || !selected.length || (!data && !images) || !validDataRange(start, end)) return;
    setBusy(true);
    await onCreate(
      buildBatchExportPayload("standard", selected, start, end, images, undefined, data),
    );
    setBusy(false);
  };
  return (
    <div className="export-system-form">
      <form className="export-builder dataset-builder" onSubmit={submit}>
        <div className="export-builder-main dataset-builder-main">
          {chooser}
          <section className="dataset-editor-section export-settings-section">
      <div className="dataset-editor-section-heading">
        <div className="dataset-step-heading">
          <span className="export-form-icon">
            2
          </span>
          <div>
            <h2 className="panel-title">标准站导出</h2>

          </div>
        </div>
      </div>
        <div className="export-settings-fields">
        <div className="export-picker-layout">
          <ExportDevicePicker
            label="标准站"
            options={pickerOptions(list)}
            selectedIds={selected}
            onChange={setSelected}
            mode="multiple"
            searchPlaceholder="搜索标准站名称或序列号"
          />
        </div>
        <RangeFields
          start={start}
          end={end}
          setStart={setStart}
          setEnd={setEnd}
        />
        <ExportContents data={data} images={images} setData={setData} setImages={setImages} />
        </div>
          </section>
        </div>
        <FormFooter feedback={feedback} count={selected.length} busy={busy} onClose={onClose} system="标准站导出" start={start} end={end} content={data && images ? "设备数据和图片" : data ? "设备数据" : images ? "图片" : "未选择"} invalid={!data && !images} />
      </form>
    </div>
  );
}
