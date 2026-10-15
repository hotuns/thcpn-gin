import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, formatApiError, type FirmwareRelease, type FirmwareArtifact, type FirmwareCandidate } from "@thcpn/api";
import { Alert, Button, Card, Empty, Form, Input, Modal, Select, Space, Spin, Tag, Upload, Tabs, Table, Popconfirm, Pagination } from "@thcpn/admin-ui";
import { PageHeader } from "@thcpn/ui";
import { useLocale } from "@thcpn/i18n";
import { Cpu, FileUp, RefreshCw, RotateCcw, Search, Upload as UploadIcon } from "lucide-react";
import { useSearchParams } from "react-router-dom";

type SourceFamily = "thcpn" | "carbon" | "lorawan_v2";

const releaseColor = (status: FirmwareRelease["status"]) => status === "completed" ? "success" : status === "failed" ? "error" : status === "partial" ? "warning" : "processing";
const targetColor = (status: string) => status === "completed" ? "success" : status === "failed" ? "error" : "processing";
const sourceColor = (family: SourceFamily) => family === "lorawan_v2" ? "blue" : family === "carbon" ? "green" : "purple";

export function AdminFirmwarePage() {
  const { t, locale } = useLocale();
  const [searchParams, setSearchParams] = useSearchParams();
  const initialDeviceId = searchParams.get("device_id") ?? undefined;
  const client = useQueryClient();
  const [form] = Form.useForm();
  const [modal, modalContextHolder] = Modal.useModal();
  const watchedVersion = Form.useWatch("version", form);
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState("library");
  const [page, setPage] = useState(1);
  const [releasePage, setReleasePage] = useState(1);
  const [selected, setSelected] = useState<FirmwareArtifact | null>(null);
  const [publishIds, setPublishIds] = useState<string[]>([]);
  const [publishKey, setPublishKey] = useState(() => crypto.randomUUID());
  const [publishError, setPublishError] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [dataSourceId, setDataSourceId] = useState<string>();
  const [status, setStatus] = useState("");
  const [sourceFilter, setSourceFilter] = useState("");
  const [search, setSearch] = useState("");
  const [formError, setFormError] = useState("");
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());
  const releases = useQuery({ queryKey: ["admin", "firmware-releases", sourceFilter, status, search, releasePage], queryFn: () => api.admin.firmwareReleases({ source_family: sourceFilter || undefined, status: status || undefined, device: search || undefined, page: releasePage, page_size: 20 }) });
  const library = useQuery({ queryKey: ["admin", "firmware-library", sourceFilter, page, initialDeviceId], queryFn: () => api.admin.firmwares({ source_family: sourceFilter || undefined, device_id: initialDeviceId, page, page_size: 20 }) });
  const sources = useQuery({ queryKey: ["admin", "sources"], queryFn: api.admin.sources });
  const sourceOptions = (sources.data?.items ?? []).filter(s => s.status === "active" && ["thcpn", "carbon", "lorawan_v2"].includes(String(s.source_family))).map(s => ({ value: String(s.id), label: `${t(`admin:firmware.source_${s.source_family}`)} · ${s.name}`, family: s.source_family as SourceFamily }));
  const sourceFamily = sourceOptions.find(s => s.value === dataSourceId)?.family;
  const devices = useQuery({ queryKey: ["admin", "firmware-devices"], queryFn: () => api.admin.firmwareCandidates(), enabled: !!initialDeviceId });
  const compatible = useQuery({ queryKey: ["admin", "firmware-compatible", selected?.id], queryFn: () => api.admin.firmwareCandidates(selected!.id), enabled: !!selected });
  const candidates = devices.data?.items ?? [];

  const resetForm = () => {
    form.resetFields();
    setFile(null);
    setDataSourceId(undefined);
    setIdempotencyKey(crypto.randomUUID());
    setFormError("");
  };
  const create = useMutation({
    mutationFn: async () => {
      setFormError("");
      if (!sourceFamily || !dataSourceId) throw new Error(t("admin:firmware.sourceValidation"));
      const values = await form.validateFields();
      const version = String(values.version ?? "").trim();
      const verifyValue = String(values.verifyValue ?? "").trim();
      const buildId = String(values.buildId ?? "").trim();
      const loraVersionValid = /^([0-9]|[1-9][0-9]|1[0-9]{2}|2[0-4][0-9]|25[0-5])(\.([0-9]|[1-9][0-9]|1[0-9]{2}|2[0-4][0-9]|25[0-5])){2}$/.test(version);
      if (!file || !version || !/^[0-9a-fA-F]{32}$/.test(verifyValue)) throw new Error(t("admin:firmware.validation"));
      if (sourceFamily === "lorawan_v2" && !loraVersionValid) throw new Error(t("admin:firmware.loraVersionValidation"));
      if (sourceFamily === "carbon" && !/^[1-9][0-9]*$/.test(buildId)) throw new Error(t("admin:firmware.buildIdValidation"));
      return api.admin.uploadFirmware({ file, version, verifyValue, buildId: sourceFamily === "carbon" ? buildId : undefined, dataSourceId, idempotencyKey });
    },
    onSuccess: async () => { setOpen(false); resetForm(); setTab("library"); setPage(1); await client.invalidateQueries({ queryKey: ["admin", "firmware-library"] }); },
    onError: (error) => setFormError(error instanceof Error ? error.message : formatApiError(error).message),
  });
  const retry = useMutation({ mutationFn: ({ releaseId, targetId }: { releaseId: string; targetId: string }) => api.admin.retryFirmwareReleaseTarget(releaseId, targetId), onSettled: () => client.invalidateQueries({ queryKey: ["admin", "firmware-releases"] }) });
  const publish = useMutation({
    mutationFn: () => api.admin.publishFirmware({ firmware_id: selected!.id, device_ids: publishIds, idempotency_key: publishKey }),
    onSuccess: async () => { setSelected(null); setTab("history"); setReleasePage(1); await client.invalidateQueries({ queryKey: ["admin", "firmware-releases"] }); },
    onError: error => setPublishError(formatApiError(error).message),
  });
  const archive = useMutation({ mutationFn: (item: FirmwareArtifact) => api.admin.archiveFirmware(item.id, !item.archived), onSettled: () => client.invalidateQueries({ queryKey: ["admin", "firmware-library"] }) });
  const option = (device: FirmwareCandidate) => ({ value: device.id, label: `${device.name} · ${device.serial_no} · ${device.data_source_name}` });
  const fmt = (value: string) => new Date(value).toLocaleString(locale);
  const close = () => { if (!create.isPending) { setOpen(false); resetForm(); } };

  return <>
    {modalContextHolder}
    <PageHeader title={t("admin:firmware.library")} description={t("admin:firmware.uploadHint")} actions={<Space><Button icon={<RefreshCw size={15} />} onClick={() => { void releases.refetch(); void library.refetch(); }}>{t("admin:firmware.refresh")}</Button><Button type="primary" icon={<UploadIcon size={15} />} onClick={() => setOpen(true)}>{t("admin:firmware.upload")}</Button></Space>} />
    <Tabs activeKey={tab} onChange={setTab} items={[{ key: "library", label: t("admin:firmware.library") }, { key: "history", label: t("admin:firmware.history") }]} />
    {initialDeviceId ? <Alert type="info" showIcon style={{ marginBottom: 16 }} message={`${t("admin:firmware.devices")} · ${candidates.find(d => d.id === initialDeviceId)?.name ?? initialDeviceId}`} description={t("admin:firmware.compatibleHint")} action={<Button onClick={() => { setSearchParams({}); setPage(1); }}>{t("admin:firmware.allSources")}</Button>} /> : null}
    <Card className="firmware-panel">
      <div className="firmware-filters">
        {tab === "history" ? <Input allowClear prefix={<Search size={15} />} value={search} onChange={(event) => { setSearch(event.target.value); setReleasePage(1); }} placeholder={t("admin:firmware.search")} /> : null}
        <Select value={sourceFilter} onChange={value => { setSourceFilter(value); setPage(1); setReleasePage(1); }} aria-label={t("admin:firmware.sourceFilter")} options={[
          { value: "", label: t("admin:firmware.allSources") },
          { value: "thcpn", label: t("admin:firmware.source_thcpn") },
          { value: "carbon", label: t("admin:firmware.source_carbon") },
          { value: "lorawan_v2", label: t("admin:firmware.source_lorawan_v2") },
        ]} />
        {tab === "history" ? <Select value={status} onChange={value => { setStatus(value); setReleasePage(1); }} aria-label={t("admin:firmware.statusFilter")} options={[
          { value: "", label: t("admin:firmware.allStatuses") },
          { value: "completed", label: t("admin:firmware.completed") },
          { value: "partial", label: t("admin:firmware.partial") },
          { value: "failed", label: t("admin:firmware.failed") },
          { value: "publishing", label: t("admin:firmware.publishing") },
        ]} /> : null}
      </div>
      {tab === "library" ? <>
        {library.error ? <Alert type="error" showIcon message={formatApiError(library.error).message} /> : null}
        {archive.error ? <Alert type="error" showIcon message={formatApiError(archive.error).message} /> : null}
        <Table<FirmwareArtifact> rowKey="id" loading={library.isLoading} dataSource={library.data?.items ?? []} scroll={{ x: 1000 }} locale={{ emptyText: t("admin:firmware.noLibrary") }} pagination={{ current: page, pageSize: 20, total: library.data?.total ?? 0, onChange: setPage, showSizeChanger: false }} columns={[
          { title: t("admin:firmware.file"), key: "file", render: (_, item) => <Space orientation="vertical" size={2}><strong>{item.original_filename}</strong><small>{(item.size_bytes / 1024 / 1024).toFixed(2)} MB · {fmt(item.created_at)}</small><code>{item.verify_value}</code></Space> },
          { title: t("admin:firmware.version"), dataIndex: "version", render: (value, item) => <Space orientation="vertical" size={2}><strong>{value}</strong>{item.build_id ? <small>Build {item.build_id}</small> : null}{item.archived ? <Tag>{t("admin:firmware.archived")}</Tag> : null}</Space> },
          { title: t("admin:firmware.sourceInstance"), key: "source", render: (_, item) => <Space orientation="vertical" size={2}><Tag color={sourceColor(item.source_family)}>{t(`admin:firmware.source_${item.source_family}`)}</Tag><span>{item.data_source_name}</span></Space> },
          { title: t("admin:firmware.actions"), key: "actions", render: (_, item) => <Space><Button type="primary" disabled={item.archived} onClick={() => { setSelected(item); setPublishIds((initialDeviceId ? [initialDeviceId] : []).filter(id => candidates.some(d => d.id === id && d.data_source_id === item.data_source_id))); setPublishKey(crypto.randomUUID()); setPublishError(""); }}>{t("admin:firmware.publishExisting")}</Button><Popconfirm title={item.archived ? t("admin:firmware.restore") : t("admin:firmware.archiveConfirm")} onConfirm={() => archive.mutateAsync(item)}><Button loading={archive.isPending}>{item.archived ? t("admin:firmware.restore") : t("admin:firmware.archive")}</Button></Popconfirm></Space> },
        ]} />
      </> : <>
      {releases.isLoading ? <div className="firmware-loading"><Spin size="large" /><span>{t("admin:firmware.loading")}</span></div>
        : releases.error ? <Alert type="error" showIcon message={t("admin:firmware.loadFailed")} description={formatApiError(releases.error).message} />
        : !releases.data?.items.length ? <Empty description={t("admin:firmware.empty")}><span>{t("admin:firmware.emptyHint")}</span></Empty>
        : <div className="firmware-release-list">{releases.data.items.map((release) => <Card className="firmware-release" key={release.id} size="small" title={<div className="firmware-release-title"><strong>{release.original_filename}</strong><span>{release.version}{release.build_id ? ` · Build ${release.build_id}` : ""} · {(release.size_bytes / 1024 / 1024).toFixed(2)} MB · {fmt(release.created_at)}</span></div>} extra={<Space><Tag color={sourceColor(release.source_family)}>{t(`admin:firmware.source_${release.source_family}`)}</Tag><Tag color={releaseColor(release.status)}>{t(`admin:firmware.${release.status}`)}</Tag></Space>}>
          <div className="firmware-targets">{release.targets.map((target) => <div className="firmware-target" key={target.id}><Cpu size={16} /><span><strong>{target.device_name}</strong><small>{target.gateway_sn || target.external_device_id || "—"}{target.workspace_name ? ` · ${target.workspace_name}` : ""}</small>{target.error_message ? <em>{target.error_message}</em> : null}</span><Tag color={targetColor(target.status)}>{t(`admin:firmware.target_${target.status}`)}</Tag>{target.status === "failed" ? <Button size="small" icon={<RotateCcw size={14} />} loading={retry.isPending} onClick={() => retry.mutate({ releaseId: release.id, targetId: target.id })}>{t("admin:firmware.retry")}</Button> : null}</div>)}</div>
        </Card>)}</div>}
      {retry.error ? <Alert type="error" showIcon message={formatApiError(retry.error).message} /> : null}
      <Pagination style={{ marginTop: 16, justifyContent: "flex-end" }} current={releasePage} pageSize={20} total={releases.data?.total ?? 0} onChange={setReleasePage} showSizeChanger={false} />
      </>}
    </Card>
    <Modal open={open} title={t("admin:firmware.upload")} okText={t("admin:firmware.upload")} cancelText={t("cancel")} confirmLoading={create.isPending} width={720} onCancel={close} onOk={() => create.mutate()} destroyOnHidden>
      <p className="firmware-dialog-description">{t("admin:firmware.uploadHint")}</p>
      <Form disabled={create.isPending} form={form} layout="vertical" requiredMark="optional" className="firmware-form">
        <Form.Item label={t("admin:firmware.sourceType")} required extra={sourceFamily ? t(`admin:firmware.sourceHint_${sourceFamily}`) : t("admin:firmware.sourceHint")}>
          <Select value={dataSourceId} loading={sources.isLoading} placeholder={t("admin:firmware.selectSourceFirst")} options={sourceOptions} onChange={(value) => { setDataSourceId(value); form.setFieldValue("buildId", undefined); setFormError(""); }} />
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
          <Form.Item name="verifyValue" label={t("admin:firmware.md5")} rules={[{ required: true, pattern: /^[0-9a-fA-F]{32}$/, message: t("admin:firmware.validation") }]}><Input maxLength={32} placeholder={t("admin:firmware.md5Placeholder")} /></Form.Item>
          {sourceFamily === "carbon" ? <Form.Item name="buildId" label={t("admin:firmware.buildId")} rules={[{ required: true, pattern: /^[1-9][0-9]*$/, message: t("admin:firmware.buildIdValidation") }]}><Input inputMode="numeric" placeholder={t("admin:firmware.buildIdPlaceholder")} /></Form.Item> : null}
        </div>
        <Alert type="info" showIcon message={`${file?.name ?? "—"} · ${watchedVersion || "—"}`} description={t("admin:firmware.uploadHint")} />
        {sources.error ? <Alert type="error" showIcon message={formatApiError(sources.error).message} /> : null}
        {formError ? <Alert type="error" showIcon message={formError} /> : null}
      </Form>
    </Modal>
    <Modal open={!!selected} title={t("admin:firmware.selectFirmware")} okText={t("admin:firmware.publishExisting")} cancelText={t("cancel")} width={720} confirmLoading={publish.isPending} okButtonProps={{ disabled: !publishIds.length || compatible.isFetching || !!compatible.error }} onCancel={() => { if (!publish.isPending) setSelected(null); }} onOk={() => modal.confirm({ title: t("admin:firmware.confirmPublish"), content: <><p>{t("admin:firmware.summary", { filename: selected?.original_filename, version: selected?.version, count: publishIds.length })}</p>{compatible.data?.items.filter(d => publishIds.includes(d.id)).map(d => <p key={d.id}>{d.name} · {d.serial_no}</p>)}</>, onOk: () => publish.mutateAsync(), okText: t("admin:firmware.publishExisting"), cancelText: t("cancel") })}>
      <Space orientation="vertical" style={{ width: "100%" }} size="middle">
        <Alert type="info" showIcon message={`${selected?.original_filename ?? ""} · ${selected?.version ?? ""}`} description={`${selected?.data_source_name ?? ""} — ${t("admin:firmware.compatibleHint")}`} />
        <Select mode="multiple" showSearch allowClear style={{ width: "100%" }} value={publishIds} options={compatible.data?.items.map(option) ?? []} optionFilterProp="label" onChange={setPublishIds} loading={compatible.isFetching} disabled={publish.isPending} placeholder={t("admin:firmware.selectDevices")} />
        {compatible.error || publishError ? <Alert type="error" showIcon message={publishError || formatApiError(compatible.error).message} /> : null}
      </Space>
    </Modal>
  </>;
}
