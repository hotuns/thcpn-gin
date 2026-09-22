import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, formatApiError, type FirmwareRelease } from "@thcpn/api";
import { Alert, Button, Card, Empty, Form, Input, Modal, Select, Space, Spin, Tag, Upload } from "@thcpn/admin-ui";
import { PageHeader } from "@thcpn/ui";
import { useLocale } from "@thcpn/i18n";
import { Cpu, FileUp, RefreshCw, RotateCcw, Search, Upload as UploadIcon } from "lucide-react";
import { useSearchParams } from "react-router-dom";

type SourceFamily = "thcpn" | "carbon" | "lorawan_v2";
type DeviceRow = { id?: string; name?: string; serial_no?: string; source_family?: SourceFamily; workspace_name?: string; source_workspace_name?: string; capabilities?: string[] };

const releaseColor = (status: FirmwareRelease["status"]) => status === "completed" ? "success" : status === "failed" ? "error" : status === "partial" ? "warning" : "processing";
const targetColor = (status: string) => status === "completed" ? "success" : status === "failed" ? "error" : "processing";
const sourceColor = (family: SourceFamily) => family === "lorawan_v2" ? "blue" : family === "carbon" ? "green" : "purple";

export function AdminFirmwarePage() {
  const { t, locale } = useLocale();
  const [searchParams] = useSearchParams();
  const client = useQueryClient();
  const [form] = Form.useForm();
  const watchedVersion = Form.useWatch("version", form);
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [deviceIds, setDeviceIds] = useState<string[]>(() => { const id = searchParams.get("device_id"); return id ? [id] : []; });
  const [sourceFamily, setSourceFamily] = useState<SourceFamily | undefined>();
  const [status, setStatus] = useState("");
  const [search, setSearch] = useState("");
  const [formError, setFormError] = useState("");
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());
  const releases = useQuery({ queryKey: ["admin", "firmware-releases", status, search], queryFn: () => api.admin.firmwareReleases({ status: status || undefined, device: search || undefined, page_size: 50 }) });
  const devices = useQuery({ queryKey: ["admin", "firmware-devices"], queryFn: () => api.admin.devices() });
  const candidates = useMemo(() => ((devices.data?.items ?? []) as DeviceRow[]).filter((device) => ["thcpn", "carbon", "lorawan_v2"].includes(device.source_family ?? "") && device.capabilities?.includes("firmware_update")), [devices.data]);
  const sourceCandidates = candidates.filter((device) => device.source_family === sourceFamily);
  const deviceOptions = sourceCandidates.map((device) => ({
    value: String(device.id),
    label: `${device.name || device.serial_no || device.id} · ${t(`admin:firmware.source_${device.source_family}`)} · ${device.serial_no ?? "—"} · ${device.workspace_name ?? device.source_workspace_name ?? t("admin:firmware.unassigned")}`,
  }));

  useEffect(() => {
    if (sourceFamily || deviceIds.length !== 1) return;
    const selected = candidates.find((device) => String(device.id) === deviceIds[0]);
    if (selected?.source_family) setSourceFamily(selected.source_family);
  }, [candidates, deviceIds, sourceFamily]);

  const resetForm = () => {
    form.resetFields();
    setFile(null);
    setDeviceIds([]);
    setSourceFamily(undefined);
    setIdempotencyKey(crypto.randomUUID());
    setFormError("");
  };
  const create = useMutation({
    mutationFn: async () => {
      setFormError("");
      if (!sourceFamily) throw new Error(t("admin:firmware.sourceValidation"));
      const values = await form.validateFields();
      const version = String(values.version ?? "").trim();
      const verifyValue = String(values.verifyValue ?? "").trim();
      const buildId = String(values.buildId ?? "").trim();
      const loraVersionValid = /^([0-9]|[1-9][0-9]|1[0-9]{2}|2[0-4][0-9]|25[0-5])(\.([0-9]|[1-9][0-9]|1[0-9]{2}|2[0-4][0-9]|25[0-5])){2}$/.test(version);
      if (!file || !version || !/^[0-9a-fA-F]{32}$/.test(verifyValue) || deviceIds.length === 0) throw new Error(t("admin:firmware.validation"));
      if (sourceFamily === "lorawan_v2" && !loraVersionValid) throw new Error(t("admin:firmware.loraVersionValidation"));
      if (sourceFamily === "carbon" && !/^[1-9][0-9]*$/.test(buildId)) throw new Error(t("admin:firmware.buildIdValidation"));
      return api.admin.createFirmwareRelease({ file, version, verifyValue, buildId: sourceFamily === "carbon" ? buildId : undefined, deviceIds, idempotencyKey });
    },
    onSuccess: async () => { setOpen(false); resetForm(); await client.invalidateQueries({ queryKey: ["admin", "firmware-releases"] }); },
    onError: (error) => setFormError(error instanceof Error ? error.message : formatApiError(error).message),
  });
  const retry = useMutation({ mutationFn: ({ releaseId, targetId }: { releaseId: string; targetId: string }) => api.admin.retryFirmwareReleaseTarget(releaseId, targetId), onSettled: () => client.invalidateQueries({ queryKey: ["admin", "firmware-releases"] }) });
  const fmt = (value: string) => new Date(value).toLocaleString(locale);
  const close = () => { if (!create.isPending) { setOpen(false); resetForm(); } };

  return <>
    <PageHeader eyebrow="Devices / firmware" title={t("admin:firmware.title")} description={t("admin:firmware.description")} actions={<Space><Button icon={<RefreshCw size={15} />} onClick={() => void releases.refetch()}>{t("admin:firmware.refresh")}</Button><Button type="primary" icon={<UploadIcon size={15} />} onClick={() => setOpen(true)}>{t("admin:firmware.create")}</Button></Space>} />
    <Card className="firmware-panel">
      <div className="firmware-filters">
        <Input allowClear prefix={<Search size={15} />} value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t("admin:firmware.search")} />
        <Select value={status} onChange={setStatus} aria-label={t("admin:firmware.statusFilter")} options={[
          { value: "", label: t("admin:firmware.allStatuses") },
          { value: "completed", label: t("admin:firmware.completed") },
          { value: "partial", label: t("admin:firmware.partial") },
          { value: "failed", label: t("admin:firmware.failed") },
          { value: "publishing", label: t("admin:firmware.publishing") },
        ]} />
      </div>
      {releases.isLoading ? <div className="firmware-loading"><Spin size="large" /><span>{t("admin:firmware.loading")}</span></div>
        : releases.error ? <Alert type="error" showIcon message={t("admin:firmware.loadFailed")} description={formatApiError(releases.error).message} />
        : !releases.data?.items.length ? <Empty description={t("admin:firmware.empty")}><span>{t("admin:firmware.emptyHint")}</span></Empty>
        : <div className="firmware-release-list">{releases.data.items.map((release) => <Card className="firmware-release" key={release.id} size="small" title={<div className="firmware-release-title"><strong>{release.original_filename}</strong><span>{release.version}{release.build_id ? ` · Build ${release.build_id}` : ""} · {(release.size_bytes / 1024 / 1024).toFixed(2)} MB · {fmt(release.created_at)}</span></div>} extra={<Space><Tag color={sourceColor(release.source_family)}>{t(`admin:firmware.source_${release.source_family}`)}</Tag><Tag color={releaseColor(release.status)}>{t(`admin:firmware.${release.status}`)}</Tag></Space>}>
          <div className="firmware-targets">{release.targets.map((target) => <div className="firmware-target" key={target.id}><Cpu size={16} /><span><strong>{target.device_name}</strong><small>{target.gateway_sn || target.external_device_id || "—"}{target.workspace_name ? ` · ${target.workspace_name}` : ""}</small>{target.error_message ? <em>{target.error_message}</em> : null}</span><Tag color={targetColor(target.status)}>{t(`admin:firmware.target_${target.status}`)}</Tag>{target.status === "failed" ? <Button size="small" icon={<RotateCcw size={14} />} loading={retry.isPending} onClick={() => retry.mutate({ releaseId: release.id, targetId: target.id })}>{t("admin:firmware.retry")}</Button> : null}</div>)}</div>
        </Card>)}</div>}
    </Card>
    <Modal open={open} title={t("admin:firmware.dialogTitle")} okText={t("admin:firmware.publish")} cancelText={t("cancel")} confirmLoading={create.isPending} width={720} onCancel={close} onOk={() => create.mutate()} destroyOnHidden>
      <p className="firmware-dialog-description">{t("admin:firmware.dialogDescription")}</p>
      <Form form={form} layout="vertical" requiredMark="optional" className="firmware-form">
        <Form.Item label={t("admin:firmware.sourceType")} required extra={sourceFamily ? t(`admin:firmware.sourceHint_${sourceFamily}`) : t("admin:firmware.sourceHint")}>
          <Select value={sourceFamily} placeholder={t("admin:firmware.selectSourceFirst")} options={[
            { value: "thcpn", label: t("admin:firmware.source_thcpn") },
            { value: "carbon", label: t("admin:firmware.source_carbon") },
            { value: "lorawan_v2", label: t("admin:firmware.source_lorawan_v2") },
          ]} onChange={(value) => { setSourceFamily(value as SourceFamily); setDeviceIds([]); form.setFieldValue("buildId", undefined); setFormError(""); }} />
        </Form.Item>
        <Form.Item label={t("admin:firmware.file")} required>
          <Upload.Dragger accept=".bin,.rbl,.zip,.tar,.gz" maxCount={1} fileList={file ? [{ uid: "firmware", name: file.name, size: file.size, type: file.type }] : []} beforeUpload={(nextFile) => { setFile(nextFile); return false; }} onRemove={() => { setFile(null); return true; }}>
            <FileUp size={28} />
            <p>{file?.name ?? t("admin:firmware.chooseFile")}</p>
            <span>{file ? `${(file.size / 1024 / 1024).toFixed(2)} MB` : t("admin:firmware.fileLimit")}</span>
          </Upload.Dragger>
        </Form.Item>
        <div className="firmware-form-grid">
          <Form.Item name="version" label={t("admin:firmware.version")} rules={[{ required: true }]}><Input placeholder={sourceFamily === "lorawan_v2" ? "1.2.3" : t("admin:firmware.versionPlaceholder")} /></Form.Item>
          <Form.Item name="verifyValue" label={t("admin:firmware.md5")} rules={[{ required: true, pattern: /^[0-9a-fA-F]{32}$/, message: t("admin:firmware.validation") }]}><Input maxLength={32} placeholder="32-character Base16" /></Form.Item>
          {sourceFamily === "carbon" ? <Form.Item name="buildId" label={t("admin:firmware.buildId")} rules={[{ required: true, pattern: /^[1-9][0-9]*$/, message: t("admin:firmware.buildIdValidation") }]}><Input inputMode="numeric" placeholder={t("admin:firmware.buildIdPlaceholder")} /></Form.Item> : null}
        </div>
        <Form.Item label={t("admin:firmware.devices")} required>
          <Select mode="multiple" allowClear showSearch disabled={!sourceFamily} loading={devices.isLoading} value={deviceIds} onChange={setDeviceIds} options={deviceOptions} optionFilterProp="label" placeholder={sourceFamily ? t("admin:firmware.selectDevices") : t("admin:firmware.selectSourceFirst")} maxTagCount="responsive" />
        </Form.Item>
        <Alert type="info" showIcon message={t("admin:firmware.summary", { filename: file?.name ?? "—", version: watchedVersion || "—", count: deviceIds.length })} />
        {formError ? <Alert type="error" showIcon message={formError} /> : null}
      </Form>
    </Modal>
  </>;
}
