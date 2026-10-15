import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, formatApiError, type FirmwareArtifact, type FirmwareRelease } from "@thcpn/api";
import { Alert, Button, Modal, Space, Table, Tag } from "@thcpn/admin-ui";
import { useLocale } from "@thcpn/i18n";

// Mounted per operation: request keys and selection must never leak to another device.
export function DeviceFirmwareDialog({ deviceId, deviceName, serialNo, onClose }: {
  deviceId: string; deviceName: string; serialNo: string; onClose: () => void;
}) {
  const { t } = useLocale();
  const client = useQueryClient();
  const [modal, contextHolder] = Modal.useModal();
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<FirmwareArtifact>();
  const [key, setKey] = useState(() => crypto.randomUUID());
  const [result, setResult] = useState<FirmwareRelease>();
  const library = useQuery({ queryKey: ["admin", "firmware-library", "device", deviceId, page], queryFn: () => api.admin.firmwares({ device_id: deviceId, page, page_size: 10 }) });
  const completed = async (release: FirmwareRelease) => {
    setResult(release);
    await client.invalidateQueries({ queryKey: ["admin", "firmware-releases"] });
  };
  const publish = useMutation({ mutationFn: () => api.admin.publishFirmware({ firmware_id: selected!.id, device_ids: [deviceId], idempotency_key: key }), onSuccess: completed });
  const retry = useMutation({ mutationFn: () => api.admin.retryFirmwareReleaseTarget(result!.id, result!.targets.find(target => target.device_id === deviceId)!.id), onSuccess: completed });
  const busy = publish.isPending || retry.isPending;
  const target = result?.targets.find(item => item.device_id === deviceId);
  const error = publish.error ?? retry.error;
  const confirm = () => modal.confirm({
    title: t("admin:firmware.confirmPublish"),
    content: <Space orientation="vertical"><strong>{deviceName} · {serialNo}</strong><span>{selected?.original_filename} · {selected?.version}</span><span>{selected?.data_source_name}</span></Space>,
    okText: t("admin:firmware.publishExisting"), cancelText: t("cancel"),
    onOk: () => publish.mutateAsync(),
  });
  return <>{contextHolder}<Modal open title={t("admin:firmware.deviceUpgrade")} width={850} onCancel={() => { if (!busy) onClose(); }} closable={!busy} mask={{ closable: !busy }} footer={<Space>
    <Button disabled={busy} onClick={onClose}>{t("close")}</Button>
    {target?.status === "failed" ? <Button type="primary" loading={retry.isPending} onClick={() => retry.mutate()}>{t("admin:firmware.retry")}</Button>
      : !result ? <Button type="primary" loading={publish.isPending} disabled={!selected || selected.archived || library.isFetching || !!library.error} onClick={() => void confirm()}>{t("admin:firmware.publishExisting")}</Button> : null}
  </Space>}>
    <Space orientation="vertical" size="middle" style={{ width: "100%" }}>
      <Alert type="info" showIcon title={`${deviceName} · ${serialNo}`} description={t("admin:firmware.deviceUpgradeHint")} />
      {library.error ? <Alert type="error" showIcon title={formatApiError(library.error).message} action={<Button onClick={() => void library.refetch()}>{t("admin:firmware.refresh")}</Button>} /> : null}
      {error ? <Alert type="error" showIcon title={formatApiError(error).message} /> : null}
      {result ? <Alert type={result.status === "completed" ? "success" : target?.status === "failed" ? "error" : "warning"} showIcon title={t(`admin:firmware.${result.status}`)} description={target?.error_message || t("admin:firmware.registeredHint")} /> : null}
      <Table<FirmwareArtifact> rowKey="id" size="small" loading={library.isFetching} dataSource={library.data?.items ?? []} scroll={{ x: 650 }} locale={{ emptyText: t("admin:firmware.noLibrary") }}
        rowSelection={{ type: "radio", selectedRowKeys: selected ? [selected.id] : [], preserveSelectedRowKeys: true, getCheckboxProps: item => ({ disabled: busy || !!result || item.archived }), onChange: (_, rows) => { setSelected(rows[0]); setKey(crypto.randomUUID()); publish.reset(); } }}
        pagination={{ current: page, pageSize: 10, total: library.data?.total ?? 0, showSizeChanger: false, onChange: setPage }} columns={[
          { title: t("admin:firmware.version"), dataIndex: "version", render: (value, item) => <Space><strong>{value}</strong>{item.archived ? <Tag>{t("admin:firmware.archived")}</Tag> : null}</Space> },
          { title: t("admin:firmware.file"), key: "file", render: (_, item) => <Space orientation="vertical" size={0}><span>{item.original_filename}</span><small>{(item.size_bytes / 1024 / 1024).toFixed(2)} MB{item.build_id ? ` · Build ${item.build_id}` : ""}</small></Space> },
          { title: t("admin:firmware.sourceInstance"), dataIndex: "data_source_name" },
        ]} />
    </Space>
  </Modal></>;
}
