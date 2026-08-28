import { useEffect, useMemo, useState, type Dispatch, type SetStateAction } from "react";
import { useQuery } from "@tanstack/react-query";
import { Clock3, Gauge, Leaf, Plus, SlidersHorizontal, Zap, X } from "lucide-react";
import {
  ApiError,
  api,
  formatApiError,
  samplingProfileLabels,
  type SamplingProfile,
  type UpdateSamplingProfile,
} from "@thcpn/api";
import { workspaceQueryKey } from "@thcpn/workspace";
import { Badge, Button, Panel, StateView } from "@thcpn/ui";

type Mode = SamplingProfile["mode"];

const presets = {
  standard: { dataMinutes: [0, 30], imageMinute: 10, imageHours: [8, 10, 14, 16] },
  low_power: { dataMinutes: [0], imageMinute: 10, imageHours: [10, 14] },
  high_frequency: { dataMinutes: [0, 20, 40], imageMinute: 10, imageHours: [8, 10, 12, 14, 16, 18] },
} as const;
const allHours = Array.from({ length: 24 }, (_, hour) => hour);

const modeItems = [
  { mode: "standard", icon: Gauge },
  { mode: "low_power", icon: Leaf },
  { mode: "high_frequency", icon: Zap },
  { mode: "custom", icon: SlidersHorizontal },
] as const;

const frequencySummary = (minutes: number[], hours: number[]) =>
  hours.length === 24
    ? `每小时 ${minutes.map((minute) => String(minute).padStart(2, "0")).join("、")} 分`
    : `${hours.map((hour) => `${String(hour).padStart(2, "0")}:00`).join("、")} 的 ${minutes.map((minute) => String(minute).padStart(2, "0")).join("、")} 分`;

export function SamplingProfilePanel({ deviceId, workspaceId, carbon = false }: { deviceId: string; workspaceId: string; carbon?: boolean }) {
  const query = useQuery({
    queryKey: workspaceQueryKey(workspaceId, "device", deviceId, "sampling-profile"),
    queryFn: () => api.devices.samplingProfile(deviceId),
  });
  const [mode, setMode] = useState<Mode>("standard");
  const [dataMinutes, setDataMinutes] = useState<number[]>([0, 30]);
  const [dataHours, setDataHours] = useState<number[]>(allHours);
  const [uploadMinutes, setUploadMinutes] = useState<number[]>([0, 30]);
  const [uploadHours, setUploadHours] = useState<number[]>(allHours);
  const [imageMinute, setImageMinute] = useState(10);
  const [imageHours, setImageHours] = useState<number[]>([8, 10, 14, 16]);
  const [imageUploadMinute, setImageUploadMinute] = useState(10);
  const [imageUploadHours, setImageUploadHours] = useState<number[]>([8, 10, 14, 16]);
  const [minuteInput, setMinuteInput] = useState("20");
  const [uploadMinuteInput, setUploadMinuteInput] = useState("20");
  const [advancedOverride, setAdvancedOverride] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!query.data) return;
    const item = query.data;
    setAdvancedOverride(false);
    setMode(item.mode);
    if (!item.advanced && item.data_minutes.length && (carbon || (item.image_minute !== undefined && item.image_hours.length))) {
      setDataMinutes(item.data_minutes);
      setDataHours(item.data_hours);
      setUploadMinutes(item.upload_minutes);
      setUploadHours(item.upload_hours);
      setImageMinute(item.image_minute ?? 0);
      setImageHours(item.image_hours);
      setImageUploadMinute(item.image_upload_minute ?? item.image_minute ?? 0);
      setImageUploadHours(item.image_upload_hours);
    }
  }, [carbon, query.data]);

  const draftSummary = useMemo(
    () => carbon
      ? `数据采集：${frequencySummary(dataMinutes, dataHours)}；数据上传：${frequencySummary(uploadMinutes, uploadHours)}`
      : `数据采集：${frequencySummary(dataMinutes, dataHours)}；数据上传：${frequencySummary(uploadMinutes, uploadHours)}；图片采集：${imageHours.map((hour) => `${String(hour).padStart(2, "0")}:${String(imageMinute).padStart(2, "0")}`).join("、")}；图片上传：${imageUploadHours.map((hour) => `${String(hour).padStart(2, "0")}:${String(imageUploadMinute).padStart(2, "0")}`).join("、")}`,
    [carbon, dataMinutes, dataHours, uploadMinutes, uploadHours, imageMinute, imageHours, imageUploadMinute, imageUploadHours],
  );
  const valid = dataMinutes.length > 0 && dataHours.length > 0 && uploadMinutes.length > 0 && uploadHours.length > 0 && (carbon || (imageHours.length > 0 && imageMinute >= 0 && imageMinute <= 59 && imageUploadHours.length > 0 && imageUploadMinute >= 0 && imageUploadMinute <= 59));
  const currentData = query.data;
  const dirty = Boolean(currentData) && (
    currentData!.advanced
      ? advancedOverride
      : mode !== currentData!.mode || JSON.stringify(carbon ? [dataMinutes, dataHours, uploadMinutes, uploadHours] : [dataMinutes, dataHours, uploadMinutes, uploadHours, imageMinute, imageHours, imageUploadMinute, imageUploadHours]) !== JSON.stringify(carbon ? [currentData!.data_minutes, currentData!.data_hours, currentData!.upload_minutes, currentData!.upload_hours] : [currentData!.data_minutes, currentData!.data_hours, currentData!.upload_minutes, currentData!.upload_hours, currentData!.image_minute, currentData!.image_hours, currentData!.image_upload_minute, currentData!.image_upload_hours])
  );
  const displayedSummary = currentData?.advanced && !advancedOverride
    ? currentData.summary
    : draftSummary;

  const chooseMode = (next: Mode) => {
    setMessage("");
    setAdvancedOverride(true);
    setMode(next);
    if (next !== "custom") {
      const preset = presets[next];
      setDataMinutes([...preset.dataMinutes]);
      setDataHours([...allHours]);
      setUploadMinutes([...preset.dataMinutes]);
      setUploadHours([...allHours]);
      setImageMinute(preset.imageMinute);
      setImageHours([...preset.imageHours]);
      setImageUploadMinute(preset.imageMinute);
      setImageUploadHours([...preset.imageHours]);
    }
  };
  const addUploadMinute = () => {
    const value = Number(uploadMinuteInput);
    if (!Number.isInteger(value) || value < 0 || value > 59) {
      setMessage("分钟必须是 0 到 59 的整数。");
      return;
    }
    setMode("custom");
    setAdvancedOverride(true);
    setUploadMinutes((current) => Array.from(new Set([...current, value])).sort((a, b) => a - b));
    setMessage("");
  };
  const toggleScheduleHour = (hour: number, setter: Dispatch<SetStateAction<number[]>>) => {
    setMode("custom");
    setAdvancedOverride(true);
    setter((current) => current.includes(hour) ? current.filter((item) => item !== hour) : [...current, hour].sort((a, b) => a - b));
  };
  const addDataMinute = () => {
    const value = Number(minuteInput);
    if (!Number.isInteger(value) || value < 0 || value > 59) {
      setMessage("分钟必须是 0 到 59 的整数。");
      return;
    }
    setMode("custom");
    setAdvancedOverride(true);
    setDataMinutes((current) => Array.from(new Set([...current, value])).sort((a, b) => a - b));
    setMessage("");
  };
  const toggleHour = (hour: number) => {
    setMode("custom");
    setAdvancedOverride(true);
    setImageHours((current) => current.includes(hour)
      ? current.filter((item) => item !== hour)
      : [...current, hour].sort((a, b) => a - b));
  };
  const save = async () => {
    if (!query.data || !valid || busy) return;
    const warning = query.data.advanced
      ? `当前是管理员高级自定义计划。应用后将覆盖数据和图片的采集、上传计划。\n\n新计划：${draftSummary}`
      : `确认更新采集策略？\n\n原计划：${query.data.summary}\n新计划：${draftSummary}`;
    if (!window.confirm(warning)) return;
    setBusy(true);
    setMessage("");
    const payload: UpdateSamplingProfile = {
      mode,
      expected_config_id: query.data.external_config_id,
      ...(mode === "custom" ? {
        data_minutes: dataMinutes,
        data_hours: dataHours,
        upload_minutes: uploadMinutes,
        upload_hours: uploadHours,
        ...(!carbon ? { image_minute: imageMinute, image_hours: imageHours, image_upload_minute: imageUploadMinute, image_upload_hours: imageUploadHours } : {}),
      } : {}),
    };
    try {
      const updated = await api.devices.updateSamplingProfile(deviceId, payload);
      setMessage(`已下发 · 配置版本 ${updated.external_config_id}`);
      await query.refetch();
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        setMessage("配置已被其他人更新，已重新加载最新版本，请确认后再次提交。");
        await query.refetch();
      } else {
        const item = formatApiError(error);
        setMessage(`${item.message}${item.requestId ? ` · request id ${item.requestId}` : ""}`);
      }
    } finally {
      setBusy(false);
    }
  };

  if (query.isLoading) return <Panel><StateView type="loading" title="正在读取采集策略" description="正在读取设备当前采集计划。" /></Panel>;
  if (query.error) {
    const error = formatApiError(query.error);
    return <Panel><StateView type="error" title="采集策略不可用" description={error.message} requestId={error.requestId} /></Panel>;
  }
  const current = query.data!;
  return (
    <Panel className="sampling-profile-panel">
      <div className="panel-header">
        <h2 className="panel-title">采集策略</h2>
        <div className="header-actions">
          {current.advanced && <Badge tone="warning">高级自定义</Badge>}
          {!current.can_edit && <Badge tone="neutral">只读</Badge>}
        </div>
      </div>
      <div className="sampling-profile-body">
        <div className="sampling-mode-control" role="radiogroup" aria-label="采集策略模式">
          {modeItems.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.mode}
                type="button"
                role="radio"
                aria-checked={mode === item.mode}
                className={mode === item.mode ? "active" : ""}
                disabled={!current.can_edit}
                onClick={() => chooseMode(item.mode)}
              >
                <Icon size={15} />{samplingProfileLabels[item.mode]}
              </button>
            );
          })}
        </div>
        <div className="sampling-summary"><Clock3 size={15} /> <span>{displayedSummary}</span></div>
        {mode === "custom" && (!current.advanced || advancedOverride) && (
          <div className="sampling-custom-grid">
            {!carbon && <section>
              <h3>数据采集频率</h3>
              <div className="minute-tags">
                {dataMinutes.map((minute) => (
                  <button key={minute} type="button" disabled={!current.can_edit} onClick={() => setDataMinutes((values) => values.filter((item) => item !== minute))}>
                    {String(minute).padStart(2, "0")} 分<X size={12} />
                  </button>
                ))}
              </div>
              {current.can_edit && <div className="sampling-add-minute"><input type="number" min={0} max={59} value={minuteInput} onChange={(event) => setMinuteInput(event.target.value)} /><Button variant="secondary" onClick={addDataMinute}><Plus size={13} />添加分钟</Button></div>}
              <div className="hour-grid">
                {allHours.map((hour) => <button key={hour} type="button" disabled={!current.can_edit} className={dataHours.includes(hour) ? "active" : ""} onClick={() => toggleScheduleHour(hour, setDataHours)}>{String(hour).padStart(2, "0")}:00</button>)}
              </div>
            </section>}
            {!carbon && <section>
              <h3>数据上传频率</h3>
              <div className="minute-tags">
                {uploadMinutes.map((minute) => (
                  <button key={minute} type="button" disabled={!current.can_edit} onClick={() => setUploadMinutes((values) => values.filter((item) => item !== minute))}>
                    {String(minute).padStart(2, "0")} 分<X size={12} />
                  </button>
                ))}
              </div>
              {current.can_edit && <div className="sampling-add-minute"><input type="number" min={0} max={59} value={uploadMinuteInput} onChange={(event) => setUploadMinuteInput(event.target.value)} /><Button variant="secondary" onClick={addUploadMinute}><Plus size={13} />添加分钟</Button></div>}
              <div className="hour-grid">
                {allHours.map((hour) => <button key={hour} type="button" disabled={!current.can_edit} className={uploadHours.includes(hour) ? "active" : ""} onClick={() => toggleScheduleHour(hour, setUploadHours)}>{String(hour).padStart(2, "0")}:00</button>)}
              </div>
            </section>}
            <section>
              <h3>图片采集</h3>
              <label className="field sampling-image-minute"><span className="field-label">每次采集的分钟</span><input type="number" min={0} max={59} disabled={!current.can_edit} value={imageMinute} onChange={(event) => { setMode("custom"); setAdvancedOverride(true); setImageMinute(Number(event.target.value)); }} /></label>
              <div className="hour-grid">
                {Array.from({ length: 24 }, (_, hour) => <button key={hour} type="button" disabled={!current.can_edit} className={imageHours.includes(hour) ? "active" : ""} onClick={() => toggleHour(hour)}>{String(hour).padStart(2, "0")}:00</button>)}
              </div>
            </section>
            <section>
              <h3>图片上传频率</h3>
              <label className="field sampling-image-minute"><span className="field-label">每次上传的分钟</span><input type="number" min={0} max={59} disabled={!current.can_edit} value={imageUploadMinute} onChange={(event) => { setMode("custom"); setAdvancedOverride(true); setImageUploadMinute(Number(event.target.value)); }} /></label>
              <div className="hour-grid">
                {allHours.map((hour) => <button key={hour} type="button" disabled={!current.can_edit} className={imageUploadHours.includes(hour) ? "active" : ""} onClick={() => toggleScheduleHour(hour, setImageUploadHours)}>{String(hour).padStart(2, "0")}:00</button>)}
              </div>
            </section>
          </div>
        )}
        {message && <div className="command-note">{message}</div>}
        {current.can_edit && <div className="sampling-profile-actions"><Button disabled={!dirty || !valid || busy} onClick={() => void save()}>{busy ? "下发中…" : "应用策略"}</Button></div>}
      </div>
    </Panel>
  );
}
