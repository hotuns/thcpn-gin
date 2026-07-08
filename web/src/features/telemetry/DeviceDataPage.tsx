import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import dayjs, { type Dayjs } from "dayjs";
import { LineChart } from "echarts/charts";
import { DataZoomComponent, GridComponent, LegendComponent, TooltipComponent } from "echarts/components";
import { init, use } from "echarts/core";
import type { EChartsOption } from "echarts";
import { CanvasRenderer } from "echarts/renderers";
import {
  Alert,
  App as AntApp,
  Button,
  Card,
  Checkbox,
  DatePicker,
  Descriptions,
  Empty,
  Form,
  Image,
  Input,
  InputNumber,
  Modal,
  Select,
  Space,
  Table,
  Tabs,
  Tag,
  Typography
} from "antd";
import type { TableColumnsType } from "antd";
import { SearchOutlined, SyncOutlined } from "@ant-design/icons";
import {
  dataStreamsApi,
  datasetsApi,
  devicesApi,
  formatApiError,
  mediaApi,
  projectsApi,
  telemetryApi,
  type DataStream,
  type DatasetDataType,
  type DatasetSourceInput,
  type Device,
  type MediaItem,
  type MediaListResponse,
  type QueryWarning,
  type TelemetrySeries,
  type TelemetryQueryResponse
} from "../../api";
import { useWorkspace } from "../../app/WorkspaceProvider";
import { formatDateTime } from "../../app/format";
import { tableScrollX } from "../../app/ui";

const IMAGE_PAGE_SIZE_LIMIT = 100;
const RESULT_TAB_DATA = "data";
const RESULT_TAB_IMAGES = "images";

use([LineChart, GridComponent, TooltipComponent, LegendComponent, DataZoomComponent, CanvasRenderer]);

interface QueryFormState {
  deviceId: string;
  selectedStreamIds: string[];
  range: [Dayjs, Dayjs] | null;
  limit: number;
}

interface DeviceDataQueryInput {
  deviceId: string;
  streamIds: string[];
  startTime: string;
  endTime: string;
  limit: number;
}

interface DeviceDataQueryResult {
  telemetry?: TelemetryQueryResponse;
  media?: MediaListResponse;
}

interface TelemetryRow {
  key: string;
  dataStreamID: string;
  streamName: string;
  streamCode: string;
  timestamp: string;
  value: number;
  unit?: string;
  quality: string;
}

interface SaveDatasetFormState {
  open: boolean;
  name: string;
  projectId: string;
  dataType: DatasetDataType;
  range: [Dayjs, Dayjs] | null;
  sources: DatasetSourceInput[];
  sourceLabel: string;
  description: string;
}

export function DeviceDataPage() {
  const { selectedWorkspaceId } = useWorkspace();
  const { message } = AntApp.useApp();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const streamAutoSelectedDeviceRef = useRef("");
  const requestedDeviceId = searchParams.get("device_id") || searchParams.get("deviceId") || "";
  const [activeResultTab, setActiveResultTab] = useState(RESULT_TAB_DATA);
  const [form, setForm] = useState<QueryFormState>({
    deviceId: "",
    selectedStreamIds: [],
    range: [dayjs().subtract(24, "hour"), dayjs()],
    limit: 500
  });
  const [saveDatasetForm, setSaveDatasetForm] = useState<SaveDatasetFormState>({
    open: false,
    name: "",
    projectId: "",
    dataType: "mixed",
    range: null,
    sources: [],
    sourceLabel: "",
    description: ""
  });

  const devices = useQuery({
    queryKey: ["devices", selectedWorkspaceId],
    queryFn: () => devicesApi.list({ workspace_id: selectedWorkspaceId }),
    enabled: Boolean(selectedWorkspaceId)
  });
  const projects = useQuery({
    queryKey: ["projects", selectedWorkspaceId],
    queryFn: () => projectsApi.list(selectedWorkspaceId),
    enabled: Boolean(selectedWorkspaceId)
  });

  const selectedDevice = useMemo(
    () => devices.data?.items.find((device) => device.id === form.deviceId),
    [devices.data?.items, form.deviceId]
  );
  const selectedGatewayChildren = useQuery({
    queryKey: ["device-children", selectedDevice?.id],
    queryFn: () => devicesApi.children(selectedDevice?.id ?? ""),
    enabled: selectedDevice?.topology_role === "gateway"
  });

  const streams = useQuery({
    queryKey: ["data-streams", form.deviceId],
    queryFn: () => dataStreamsApi.list(form.deviceId),
    enabled: Boolean(form.deviceId)
  });

  const visibleStreams = useMemo(
    () => (streams.data?.items ?? []).filter((stream) => stream.status === "active" && (stream.type === "telemetry" || stream.type === "image")),
    [streams.data?.items]
  );
  const telemetryStreams = useMemo(() => visibleStreams.filter((stream) => stream.type === "telemetry"), [visibleStreams]);
  const imageStreams = useMemo(() => visibleStreams.filter((stream) => stream.type === "image"), [visibleStreams]);
  const selectedStream = useMemo(
    () => visibleStreams.find((stream) => form.selectedStreamIds.length === 1 && stream.id === form.selectedStreamIds[0]),
    [form.selectedStreamIds, visibleStreams]
  );
  const selectedStreams = useMemo(
    () => visibleStreams.filter((stream) => form.selectedStreamIds.includes(stream.id)),
    [form.selectedStreamIds, visibleStreams]
  );
  const streamsByID = useMemo(() => new Map(visibleStreams.map((stream) => [stream.id, stream])), [visibleStreams]);

  const query = useMutation({
    mutationFn: async (input: DeviceDataQueryInput): Promise<DeviceDataQueryResult> => {
      const selected = visibleStreams.filter((stream) => input.streamIds.includes(stream.id));
      const selectedTelemetryStreams = selected.filter((stream) => stream.type === "telemetry");
      const selectedImageStreams = selected.filter((stream) => stream.type === "image");
      const telemetryParams = {
        start_time: input.startTime,
        end_time: input.endTime,
        limit: input.limit
      };
      const mediaParams = {
        start_time: input.startTime,
        end_time: input.endTime,
        page: 1,
        page_size: Math.min(input.limit, IMAGE_PAGE_SIZE_LIMIT)
      };

      const [telemetryResponses, mediaResponses] = await Promise.all([
        Promise.all(selectedTelemetryStreams.map((stream) => telemetryApi.queryDataStream(stream.id, telemetryParams))),
        Promise.all(selectedImageStreams.map((stream) => mediaApi.listDataStream(stream.id, mediaParams)))
      ]);

      const telemetry =
        telemetryResponses.length > 0
          ? {
              device_id: input.deviceId,
              start_time: input.startTime,
              end_time: input.endTime,
              limit: input.limit,
              series: telemetryResponses.flatMap((result) => result.series)
            }
          : undefined;
      const mediaItems = mediaResponses.flatMap((result) => result.items).sort((left, right) => dayjs(right.captured_at).valueOf() - dayjs(left.captured_at).valueOf());
      const media =
        mediaResponses.length > 0
          ? {
              items: mediaItems.slice(0, Math.min(input.limit, IMAGE_PAGE_SIZE_LIMIT)),
              page: 1,
              page_size: Math.min(input.limit, IMAGE_PAGE_SIZE_LIMIT),
              total: mediaResponses.reduce((sum, result) => sum + result.total, 0)
            }
          : undefined;
      return { telemetry, media };
    }
  });

  const telemetryResult = query.data?.telemetry;
  const mediaResult = query.data?.media;
  const rows = useMemo(() => flattenTelemetryRows(telemetryResult), [telemetryResult]);
  const warnings = useMemo(() => collectWarnings(telemetryResult), [telemetryResult]);
  const mediaItems = mediaResult?.items ?? [];
  const deviceOptions = useMemo(
    () =>
      (devices.data?.items ?? []).map((device) => ({
        label: `${deviceTopologyText(device)} · ${device.name} · ${device.serial_no}`,
        value: device.id
      })),
    [devices.data?.items]
  );
  const requestedDeviceMissing = Boolean(
    requestedDeviceId && !devices.isLoading && devices.data && !devices.data.items.some((device) => device.id === requestedDeviceId)
  );
  const selectedTelemetryStreams = useMemo(() => selectedStreams.filter((stream) => stream.type === "telemetry"), [selectedStreams]);
  const selectedImageStreams = useMemo(() => selectedStreams.filter((stream) => stream.type === "image"), [selectedStreams]);
  const projectOptions = useMemo(
    () => [
      { label: "不绑定项目", value: "" },
      ...(projects.data?.items ?? []).map((project) => ({ label: project.name, value: project.id }))
    ],
    [projects.data?.items]
  );

  useEffect(() => {
    if (!requestedDeviceId || devices.isLoading) {
      return;
    }
    const matchedDevice = devices.data?.items.find((device) => device.id === requestedDeviceId);
    if (!matchedDevice || form.deviceId === requestedDeviceId) {
      return;
    }
    streamAutoSelectedDeviceRef.current = "";
    setForm((current) => ({
      ...current,
      deviceId: requestedDeviceId,
      selectedStreamIds: []
    }));
    query.reset();
  }, [devices.data?.items, devices.isLoading, form.deviceId, requestedDeviceId]);

  useEffect(() => {
    if (!query.data) {
      return;
    }
    if (query.data.telemetry) {
      setActiveResultTab(RESULT_TAB_DATA);
      return;
    }
    if (query.data.media) {
      setActiveResultTab(RESULT_TAB_IMAGES);
    }
  }, [query.data]);

  useEffect(() => {
    if (!form.deviceId) {
      streamAutoSelectedDeviceRef.current = "";
      return;
    }
    if (streams.isLoading) {
      return;
    }
    if (visibleStreams.length === 0) {
      if (form.selectedStreamIds.length > 0) {
        setForm((current) => ({ ...current, selectedStreamIds: [] }));
      }
      return;
    }
    const visibleIDs = new Set(visibleStreams.map((stream) => stream.id));
    const currentVisibleIDs = form.selectedStreamIds.filter((streamId) => visibleIDs.has(streamId));
    if (streamAutoSelectedDeviceRef.current !== form.deviceId && currentVisibleIDs.length === 0) {
      streamAutoSelectedDeviceRef.current = form.deviceId;
      setForm((current) => ({ ...current, selectedStreamIds: visibleStreams.map((stream) => stream.id) }));
    } else if (currentVisibleIDs.length !== form.selectedStreamIds.length) {
      setForm((current) => ({ ...current, selectedStreamIds: currentVisibleIDs }));
    }
  }, [form.deviceId, form.selectedStreamIds, streams.isLoading, visibleStreams]);

  const createDataset = useMutation({
    mutationFn: (values: SaveDatasetFormState) => {
      if (!values.range) {
        throw new Error("missing dataset range");
      }
      return datasetsApi.create({
        workspace_id: selectedWorkspaceId,
        project_id: optionalTrim(values.projectId),
        name: values.name.trim(),
        description: optionalTrim(values.description),
        data_type: values.dataType,
        time_start: values.range[0].toISOString(),
        time_end: values.range[1].toISOString(),
        sources: values.sources
      });
    },
    onSuccess: () => {
      setSaveDatasetForm(emptySaveDatasetForm());
      void queryClient.invalidateQueries({ queryKey: ["datasets", selectedWorkspaceId] });
      void message.success("数据集已创建");
    }
  });

  const columns: TableColumnsType<TelemetryRow> = [
    {
      key: "stream",
      title: "数据流",
      width: 240,
      render: (_, row) => (
        <div className="table-primary">
          <strong>{row.streamName}</strong>
          <span>{row.streamCode}</span>
        </div>
      )
    },
    {
      key: "timestamp",
      title: "时间",
      width: 220,
      render: (_, row) => <Typography.Text className="mono">{formatDateTime(row.timestamp)}</Typography.Text>
    },
    {
      key: "value",
      title: "值",
      width: 160,
      render: (_, row) => <Typography.Text strong>{formatTelemetryValue(row.value)}</Typography.Text>
    },
    {
      key: "unit",
      title: "单位",
      width: 110,
      render: (_, row) => row.unit || "-"
    },
    {
      key: "quality",
      title: "质量",
      width: 130,
      render: (_, row) => <Tag color={row.quality === "valid" ? "success" : "warning"}>{row.quality}</Tag>
    },
    {
      key: "data_stream_id",
      title: "DataStream ID",
      width: 260,
      render: (_, row) => (
        <Typography.Text className="copyable-id mono" copyable={{ text: row.dataStreamID, tooltips: ["复制 ID", "已复制"] }} ellipsis title={row.dataStreamID}>
          {row.dataStreamID}
        </Typography.Text>
      )
    }
  ];

  function handleDeviceChange(deviceId: string) {
    streamAutoSelectedDeviceRef.current = "";
    const nextParams = new URLSearchParams(searchParams);
    if (deviceId) {
      nextParams.set("device_id", deviceId);
      nextParams.delete("deviceId");
    } else {
      nextParams.delete("device_id");
      nextParams.delete("deviceId");
    }
    setSearchParams(nextParams, { replace: true });
    setForm((current) => ({
      ...current,
      deviceId,
      selectedStreamIds: []
    }));
    query.reset();
  }

  function selectStreamGroup(streamsToSelect: DataStream[]) {
    setForm((current) => {
      const selectedIDs = new Set(current.selectedStreamIds);
      streamsToSelect.forEach((stream) => selectedIDs.add(stream.id));
      return { ...current, selectedStreamIds: Array.from(selectedIDs) };
    });
  }

  function clearStreamGroup(streamsToClear: DataStream[]) {
    const streamIDs = new Set(streamsToClear.map((stream) => stream.id));
    setForm((current) => ({
      ...current,
      selectedStreamIds: current.selectedStreamIds.filter((streamId) => !streamIDs.has(streamId))
    }));
  }

  function handleQuery() {
    if (!form.deviceId) {
      void message.warning("请选择设备");
      return;
    }
    if (!form.range) {
      void message.warning("请选择时间范围");
      return;
    }
    if (form.range[1].isBefore(form.range[0])) {
      void message.warning("结束时间必须晚于开始时间");
      return;
    }
    if (form.selectedStreamIds.length === 0) {
      void message.warning("请选择至少一条数据流");
      return;
    }

    query.mutate({
      deviceId: form.deviceId,
      streamIds: form.selectedStreamIds,
      startTime: form.range[0].toISOString(),
      endTime: form.range[1].toISOString(),
      limit: form.limit
    });
  }

  function openSaveDatasetModal() {
    if (!form.deviceId || !selectedDevice) {
      void message.warning("请选择设备");
      return;
    }
    if (!form.range) {
      void message.warning("请选择时间范围");
      return;
    }
    if (form.range[1].isBefore(form.range[0])) {
      void message.warning("结束时间必须晚于开始时间");
      return;
    }

    if (form.selectedStreamIds.length === 0) {
      void message.warning("请选择至少一条数据流");
      return;
    }
    const sources = selectedStreams.map((stream) => ({ source_type: "data_stream" as const, source_id: stream.id }));
    const dataType = inferDatasetType(selectedTelemetryStreams.length > 0, selectedImageStreams.length > 0);
    if (selectedStreams.length > 1) {
      setSaveDatasetForm({
        open: true,
        name: `${selectedDevice.name} ${form.range[0].format("YYYY-MM-DD HH:mm")} 数据集`,
        projectId: selectedDevice.project_id || "",
        dataType,
        range: form.range,
        sources,
        sourceLabel: `${selectedDevice.name} · 已选 ${selectedStreams.length} 条数据流`,
        description: ""
      });
      return;
    }

    if (!selectedStream) {
      void message.warning("当前数据流不能保存为数据集");
      return;
    }
    setSaveDatasetForm({
      open: true,
      name: `${selectedStream.name} ${form.range[0].format("YYYY-MM-DD HH:mm")} 数据集`,
      projectId: selectedDevice.project_id || "",
      dataType: selectedStream.type,
      range: form.range,
      sources,
      sourceLabel: `${selectedDevice.name} · ${selectedStream.name} · ${selectedStream.code}`,
      description: ""
    });
  }

  function submitSaveDataset() {
    if (!saveDatasetForm.name.trim()) {
      void message.warning("请输入数据集名称");
      return;
    }
    if (!saveDatasetForm.range) {
      void message.warning("请选择时间范围");
      return;
    }
    if (saveDatasetForm.sources.length === 0) {
      void message.warning("缺少数据来源");
      return;
    }
    createDataset.mutate(saveDatasetForm);
  }

  return (
    <section className="page device-data-page">
      <header className="page-header">
        <div>
          <Typography.Title level={2}>设备数据查询</Typography.Title>
        </div>
        <Button
          icon={<SyncOutlined />}
          onClick={() => {
            void devices.refetch();
            if (form.deviceId) {
              void streams.refetch();
            }
          }}
        >
          刷新资源
        </Button>
      </header>

      <Card className="section query-panel" title="查询条件">
        <div className="device-query-layout">
          <Form.Item className="field" label="设备" required>
            <Select
              className="control"
              disabled={devices.isLoading}
              loading={devices.isLoading}
              onChange={handleDeviceChange}
              options={deviceOptions}
              placeholder="选择设备"
              showSearch
              optionFilterProp="label"
              value={form.deviceId || undefined}
            />
          </Form.Item>
          <Form.Item className="field device-data-range" label="时间范围" required>
            <DatePicker.RangePicker
              className="control"
              onChange={(value) => {
                setForm({
                  ...form,
                  range: value && value[0] && value[1] ? [value[0], value[1]] : null
                });
              }}
              showTime
              value={form.range}
            />
          </Form.Item>
          <Form.Item className="field" label="结果上限">
            <InputNumber
              className="control"
              max={5000}
              min={1}
              onChange={(value) => setForm({ ...form, limit: Number(value || 500) })}
              value={form.limit}
            />
          </Form.Item>
        </div>

        {selectedDevice?.topology_role === "gateway" ? (
          <div className="gateway-node-shortcuts">
            <div className="gateway-node-shortcuts-head">
              <Typography.Text strong>组网站节点</Typography.Text>
              <Tag color="purple">组网站</Tag>
            </div>
            {selectedGatewayChildren.error ? (
              <Alert message={formatApiError(selectedGatewayChildren.error)} showIcon type="error" />
            ) : selectedGatewayChildren.data && selectedGatewayChildren.data.items.length === 0 ? (
              <Empty description="当前账号没有可查看的节点，或节点尚未分配到当前工作区" image={Empty.PRESENTED_IMAGE_SIMPLE} />
            ) : (
              <div className="gateway-node-shortcut-grid">
                {(selectedGatewayChildren.data?.items ?? []).map((child) => (
                  <Button key={child.device.id} onClick={() => handleDeviceChange(child.device.id)}>
                    <span>{child.device.name}</span>
                  </Button>
                ))}
              </div>
            )}
          </div>
        ) : null}

        <div className="stream-check-panel">
          <div className="stream-check-header">
            <Space align="center" size={8}>
              <Typography.Text strong>数据流</Typography.Text>
              <Tag>{form.deviceId ? `${form.selectedStreamIds.length}/${visibleStreams.length}` : "0/0"}</Tag>
            </Space>
            <Space size={8}>
              <Button disabled={visibleStreams.length === 0} onClick={() => setForm((current) => ({ ...current, selectedStreamIds: visibleStreams.map((stream) => stream.id) }))} size="small">
                全选
              </Button>
              <Button disabled={visibleStreams.length === 0} onClick={() => setForm((current) => ({ ...current, selectedStreamIds: [] }))} size="small">
                清空
              </Button>
            </Space>
          </div>
          {form.deviceId ? (
            visibleStreams.length > 0 ? (
              <Checkbox.Group
                className="stream-checkbox-sections"
                onChange={(values) => setForm((current) => ({ ...current, selectedStreamIds: values.map(String) }))}
                value={form.selectedStreamIds}
              >
                {telemetryStreams.length > 0 ? (
                  <div className="stream-checkbox-section">
                    <div className="stream-checkbox-section-header">
                      <div className="stream-checkbox-section-title">
                        <Typography.Text strong>遥测数据流</Typography.Text>
                        <Tag>{selectedTelemetryStreams.length}/{telemetryStreams.length}</Tag>
                      </div>
                      <Space size={6}>
                        <Button onClick={() => selectStreamGroup(telemetryStreams)} size="small" type="text">
                          全选
                        </Button>
                        <Button onClick={() => clearStreamGroup(telemetryStreams)} size="small" type="text">
                          清空
                        </Button>
                      </Space>
                    </div>
                    <div className="stream-checkbox-grid">
                      {telemetryStreams.map((stream) => (
                        <Checkbox className="stream-checkbox-item" key={stream.id} value={stream.id}>
                          <span>{stream.name}</span>
                        </Checkbox>
                      ))}
                    </div>
                  </div>
                ) : null}
                {imageStreams.length > 0 ? (
                  <div className="stream-checkbox-section">
                    <div className="stream-checkbox-section-header">
                      <div className="stream-checkbox-section-title">
                        <Typography.Text strong>图片数据流</Typography.Text>
                        <Tag>{selectedImageStreams.length}/{imageStreams.length}</Tag>
                      </div>
                      <Space size={6}>
                        <Button onClick={() => selectStreamGroup(imageStreams)} size="small" type="text">
                          全选
                        </Button>
                        <Button onClick={() => clearStreamGroup(imageStreams)} size="small" type="text">
                          清空
                        </Button>
                      </Space>
                    </div>
                    <div className="stream-checkbox-grid">
                      {imageStreams.map((stream) => (
                        <Checkbox className="stream-checkbox-item" key={stream.id} value={stream.id}>
                          <span>{stream.name}</span>
                        </Checkbox>
                      ))}
                    </div>
                  </div>
                ) : null}
              </Checkbox.Group>
            ) : (
              <Empty description={streams.isLoading ? "正在加载数据流" : "当前设备没有可查询的数据流"} image={Empty.PRESENTED_IMAGE_SIMPLE} />
            )
          ) : (
            <Empty description="选择设备后显示可查询的数据流" image={Empty.PRESENTED_IMAGE_SIMPLE} />
          )}
        </div>

        <div className="query-actions">
          <Button
            disabled={!form.deviceId || !form.range || streams.isLoading || form.selectedStreamIds.length === 0}
            icon={<SearchOutlined />}
            loading={query.isPending}
            onClick={handleQuery}
            type="primary"
          >
            查询数据
          </Button>
        </div>

        {!devices.isLoading && devices.data?.items.length === 0 ? (
          <Alert className="query-alert" message="当前工作区没有已分配设备。请系统管理员在后台同步设备并分配到当前工作区。" showIcon type="info" />
        ) : null}
        {requestedDeviceMissing ? <Alert className="query-alert" message="链接中的设备不在当前工作区，或当前账号没有查看权限。" showIcon type="warning" /> : null}
        {streams.error ? <Alert className="query-alert" message={formatApiError(streams.error)} showIcon type="error" /> : null}
        {query.error ? <Alert className="query-alert" message={formatApiError(query.error)} showIcon type="error" /> : null}
      </Card>

      <Card className="section" title="查询上下文">
        <Descriptions bordered column={{ lg: 4, md: 2, sm: 1, xs: 1 }} size="small">
          <Descriptions.Item label="设备">{describeDevice(selectedDevice)}</Descriptions.Item>
          <Descriptions.Item label="数据流">{describeSelectedStreams(selectedStreams, telemetryStreams.length, imageStreams.length)}</Descriptions.Item>
          <Descriptions.Item label="时间范围">{describeRange(form.range)}</Descriptions.Item>
          <Descriptions.Item label="结果">{describeQueryResult(query.data, rows.length, mediaItems.length, form.limit)}</Descriptions.Item>
        </Descriptions>
      </Card>

      <Card
        className="section"
        extra={
          <Button disabled={!form.deviceId || !form.range || streams.isLoading || form.selectedStreamIds.length === 0} onClick={openSaveDatasetModal}>
            保存为数据集
          </Button>
        }
        title={
          <Typography.Text strong>查询结果</Typography.Text>
        }
      >
        {warnings.length > 0 ? (
          <div className="warning-stack">
            {warnings.map((warning) => (
              <Alert key={`${warning.code}-${warning.message}`} message={warning.message} showIcon type="warning" />
            ))}
          </div>
        ) : null}

        <Tabs
          activeKey={activeResultTab}
          className="result-tabs"
          items={[
            {
              children: telemetryResult ? (
                <TelemetryCharts result={telemetryResult} />
              ) : (
                <Empty description={query.data ? "本次查询没有遥测数据" : "提交查询后显示数据图表"} image={Empty.PRESENTED_IMAGE_SIMPLE} />
              ),
              key: RESULT_TAB_DATA,
              label: `数据 (${rows.length})`
            },
            {
              children: mediaResult ? (
                <ImagePreviewCategories items={mediaItems} streamsByID={streamsByID} />
              ) : (
                <Empty description={query.data ? "本次查询没有图片" : "提交查询后显示图片预览"} image={Empty.PRESENTED_IMAGE_SIMPLE} />
              ),
              key: RESULT_TAB_IMAGES,
              label: `图片 (${mediaItems.length})`
            },
            {
              children: telemetryResult ? (
                <Table<TelemetryRow>
                  className="data-table telemetry-result-table"
                  columns={columns}
                  dataSource={rows}
                  loading={query.isPending}
                  locale={{ emptyText: "这个时间范围内没有可显示的遥测记录" }}
                  pagination={{ pageSize: 50, showSizeChanger: true }}
                  rowKey={(row) => row.key}
                  scroll={{ x: tableScrollX(columns) }}
                  size="middle"
                  tableLayout="fixed"
                />
              ) : (
                <Empty description={query.data ? "本次查询没有遥测明细" : "提交查询后显示明细表"} image={Empty.PRESENTED_IMAGE_SIMPLE} />
              ),
              key: "detail",
              label: `明细 (${rows.length})`
            }
          ]}
          onChange={setActiveResultTab}
        />
      </Card>

      <Modal
        confirmLoading={createDataset.isPending}
        okText="创建数据集"
        onCancel={() => setSaveDatasetForm(emptySaveDatasetForm())}
        onOk={submitSaveDataset}
        open={saveDatasetForm.open}
        title="保存为数据集"
      >
        <Form layout="vertical">
          <Form.Item label="数据集名称" required>
            <Input
              onChange={(event) => setSaveDatasetForm((current) => ({ ...current, name: event.target.value }))}
              value={saveDatasetForm.name}
            />
          </Form.Item>
          <Form.Item label="项目">
            <Select
              loading={projects.isLoading}
              onChange={(value) => setSaveDatasetForm((current) => ({ ...current, projectId: value }))}
              options={projectOptions}
              value={saveDatasetForm.projectId}
            />
          </Form.Item>
          <Form.Item label="数据类型" required>
            <Select
              onChange={(value: DatasetDataType) => setSaveDatasetForm((current) => ({ ...current, dataType: value }))}
              options={[
                { label: "遥测", value: "telemetry" },
                { label: "图片", value: "image" },
                { label: "混合", value: "mixed" }
              ]}
              value={saveDatasetForm.dataType}
            />
          </Form.Item>
          <Form.Item label="时间范围" required>
            <DatePicker.RangePicker
              className="control"
              onChange={(value) =>
                setSaveDatasetForm((current) => ({
                  ...current,
                  range: value && value[0] && value[1] ? [value[0], value[1]] : null
                }))
              }
              showTime
              value={saveDatasetForm.range}
            />
          </Form.Item>
          <Form.Item label="数据来源">
            <Typography.Text>{saveDatasetForm.sourceLabel || "-"}</Typography.Text>
          </Form.Item>
          <Form.Item label="描述">
            <Input.TextArea
              autoSize={{ minRows: 3, maxRows: 5 }}
              onChange={(event) => setSaveDatasetForm((current) => ({ ...current, description: event.target.value }))}
              placeholder="记录实验批次、用途或交付说明"
              value={saveDatasetForm.description}
            />
          </Form.Item>
          {createDataset.error ? <Alert message={formatApiError(createDataset.error)} showIcon type="error" /> : null}
        </Form>
      </Modal>
    </section>
  );
}

function emptySaveDatasetForm(): SaveDatasetFormState {
  return {
    open: false,
    name: "",
    projectId: "",
    dataType: "mixed",
    range: null,
    sources: [],
    sourceLabel: "",
    description: ""
  };
}

function inferDatasetType(hasTelemetry: boolean, hasImages: boolean): DatasetDataType {
  if (hasTelemetry && hasImages) {
    return "mixed";
  }
  if (hasImages) {
    return "image";
  }
  return "telemetry";
}

function optionalTrim(value?: string): string | undefined {
  return value?.trim() || undefined;
}

function ImagePreviewCategories({ items, streamsByID }: { items: MediaItem[]; streamsByID: Map<string, DataStream> }) {
  const groups = useMemo(() => groupMediaItemsByStream(items, streamsByID), [items, streamsByID]);

  if (items.length === 0) {
    return <Empty description="这个时间范围内没有图片" image={Empty.PRESENTED_IMAGE_SIMPLE} />;
  }

  return (
    <Tabs
      className="media-category-tabs"
      items={groups.map((group) => ({
        children: (
          <div className="media-category-panel">
            <div className="media-category-meta">
              <Typography.Text strong>{group.stream?.name || "未命名图片流"}</Typography.Text>
              <Typography.Text className="mono" type="secondary">
                {group.stream?.code || group.dataStreamID}
              </Typography.Text>
            </div>
            <ImagePreviewGrid items={group.items} streamsByID={streamsByID} />
          </div>
        ),
        key: group.dataStreamID,
        label: `${group.stream?.name || "图片流"} (${group.items.length})`
      }))}
    />
  );
}

function TelemetryCharts({ result }: { result: TelemetryQueryResponse }) {
  if (result.series.length === 0) {
    return <Empty description="这个时间范围内没有可绘制的数据流" image={Empty.PRESENTED_IMAGE_SIMPLE} />;
  }

  return (
    <div className="telemetry-chart-list">
      {result.series.map((series) => (
        <div className="telemetry-series-panel" key={series.data_stream_id}>
          <div className="telemetry-series-header">
            <div className="telemetry-series-title">
              <Typography.Text strong>{series.name}</Typography.Text>
              <Typography.Text className="mono" type="secondary">
                {series.code}
              </Typography.Text>
            </div>
            <Space className="telemetry-series-meta" size={[6, 6]} wrap>
              {series.unit ? <Tag color="processing">{series.unit}</Tag> : null}
              <Tag>{series.points.length} 条记录</Tag>
            </Space>
          </div>
          <TelemetrySeriesChart series={series} />
        </div>
      ))}
    </div>
  );
}

function TelemetrySeriesChart({ series }: { series: TelemetrySeries }) {
  const chartRef = useRef<HTMLDivElement>(null);
  const hasPoints = series.points.length > 0;

  useEffect(() => {
    if (!chartRef.current || !hasPoints) {
      return undefined;
    }

    const chart = init(chartRef.current, undefined, { renderer: "canvas" });
    chart.setOption(buildTelemetryChartOption(series), true);

    const resize = () => chart.resize();
    const observer = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(resize);
    observer?.observe(chartRef.current);
    window.addEventListener("resize", resize);

    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", resize);
      chart.dispose();
    };
  }, [hasPoints, series]);

  if (!hasPoints) {
    return <Empty className="telemetry-chart-empty" description="这个时间范围内没有可绘制的遥测记录" image={Empty.PRESENTED_IMAGE_SIMPLE} />;
  }

  return <div aria-label={`${series.name}趋势图`} className="telemetry-chart" ref={chartRef} />;
}

function ImagePreviewGrid({ items, streamsByID }: { items: MediaItem[]; streamsByID: Map<string, DataStream> }) {
  if (items.length === 0) {
    return <Empty description="这个时间范围内没有图片" image={Empty.PRESENTED_IMAGE_SIMPLE} />;
  }

  return (
    <Image.PreviewGroup>
      <div className="media-preview-grid">
        {items.map((item) => {
          const stream = streamsByID.get(item.data_stream_id);
          return (
            <div className="media-preview-item" key={`${item.data_stream_id}-${item.id}`}>
              <Image
                alt={stream ? `${stream.name} ${formatDateTime(item.captured_at)}` : `图片 ${formatDateTime(item.captured_at)}`}
                fallback="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='320' height='180' viewBox='0 0 320 180'%3E%3Crect width='320' height='180' fill='%23f2f5f7'/%3E%3Ctext x='160' y='92' text-anchor='middle' fill='%235b6671' font-family='Arial' font-size='14'%3EImage unavailable%3C/text%3E%3C/svg%3E"
                height={148}
                preview={{ src: item.preview_url }}
                src={item.thumbnail_url || item.preview_url}
                width="100%"
              />
              <div className="media-preview-meta">
                <Typography.Text strong ellipsis title={stream?.name || item.media_type}>
                  {stream?.name || "图片"}
                </Typography.Text>
                <Typography.Text className="mono" type="secondary">
                  {formatDateTime(item.captured_at)}
                </Typography.Text>
                <Typography.Text className="copyable-id mono" copyable={{ text: item.id, tooltips: ["复制 ID", "已复制"] }} ellipsis title={item.id}>
                  {item.id}
                </Typography.Text>
              </div>
            </div>
          );
        })}
      </div>
    </Image.PreviewGroup>
  );
}

function groupMediaItemsByStream(items: MediaItem[], streamsByID: Map<string, DataStream>) {
  const groups = new Map<string, { dataStreamID: string; stream?: DataStream; items: MediaItem[] }>();
  for (const item of items) {
    const group = groups.get(item.data_stream_id);
    if (group) {
      group.items.push(item);
      continue;
    }
    groups.set(item.data_stream_id, {
      dataStreamID: item.data_stream_id,
      stream: streamsByID.get(item.data_stream_id),
      items: [item]
    });
  }
  return Array.from(groups.values()).sort((left, right) => {
    const leftName = left.stream?.name || left.dataStreamID;
    const rightName = right.stream?.name || right.dataStreamID;
    return leftName.localeCompare(rightName, "zh-Hans-CN");
  });
}

function buildTelemetryChartOption(series: TelemetrySeries): EChartsOption {
  return {
    animation: false,
    color: ["#0e7c86"],
    dataZoom: [
      { type: "inside", throttle: 80 },
      { bottom: 0, height: 24, type: "slider" }
    ],
    grid: { bottom: 48, containLabel: true, left: 18, right: 18, top: 20 },
    series: [
      {
        data: series.points.map((point) => [point.ts, point.value]),
        name: `${series.name}${series.unit ? ` (${series.unit})` : ""}`,
        showSymbol: false,
        smooth: true,
        type: "line"
      }
    ],
    tooltip: {
      axisPointer: { type: "cross" },
      trigger: "axis"
    },
    xAxis: {
      axisLabel: { hideOverlap: true },
      type: "time"
    },
    yAxis: {
      name: series.unit || undefined,
      nameGap: 14,
      scale: true,
      type: "value"
    }
  };
}

function flattenTelemetryRows(result?: TelemetryQueryResponse): TelemetryRow[] {
  if (!result) {
    return [];
  }

  return result.series.flatMap((series) =>
    series.points.map((point, index) => ({
      key: `${series.data_stream_id}-${point.ts}-${index}`,
      dataStreamID: series.data_stream_id,
      streamName: series.name,
      streamCode: series.code,
      timestamp: point.ts,
      value: point.value,
      unit: series.unit,
      quality: point.quality
    }))
  );
}

function collectWarnings(result?: TelemetryQueryResponse): QueryWarning[] {
  const seen = new Set<string>();
  const warnings: QueryWarning[] = [];
  for (const series of result?.series ?? []) {
    for (const warning of series.warnings ?? []) {
      const key = `${warning.code}:${warning.message}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      warnings.push(warning);
    }
  }
  return warnings;
}

function describeDevice(device?: Device): string {
  if (!device) {
    return "-";
  }
  return `${deviceTopologyText(device)} · ${device.name} · ${device.serial_no}`;
}

function deviceTopologyText(device: Device): string {
  if (device.topology_role === "gateway") {
    return `组网站 (${device.child_count ?? 0} 节点)`;
  }
  if (device.topology_role === "gateway_node") {
    return "节点";
  }
  return "普通设备";
}

function describeSelectedStreams(selectedStreams: DataStream[], telemetryCount: number, imageCount: number): string {
  if (selectedStreams.length === 0) {
    return `未选择 (可选遥测 ${telemetryCount}，图片 ${imageCount})`;
  }
  if (selectedStreams.length === 1) {
    const [stream] = selectedStreams;
    return `${streamTypeLabel(stream.type)} · ${stream.name} · ${stream.code}`;
  }
  const telemetrySelected = selectedStreams.filter((stream) => stream.type === "telemetry").length;
  const imageSelected = selectedStreams.filter((stream) => stream.type === "image").length;
  return `已选 ${selectedStreams.length} 条 (遥测 ${telemetrySelected}，图片 ${imageSelected})`;
}

function describeRange(range: [Dayjs, Dayjs] | null): string {
  if (!range) {
    return "-";
  }
  return `${range[0].format("YYYY-MM-DD HH:mm:ss")} - ${range[1].format("YYYY-MM-DD HH:mm:ss")}`;
}

function describeQueryResult(result: DeviceDataQueryResult | undefined, telemetryRecordCount: number, imageCount: number, limit: number): string {
  if (!result) {
    return `上限 ${limit}`;
  }
  return `${telemetryRecordCount} 条遥测记录，${imageCount} 张图片`;
}

function describeResultSummary(result: DeviceDataQueryResult | undefined, telemetryRecordCount: number, imageCount: number): string {
  if (!result) {
    return "提交查询后显示趋势图和图片";
  }
  const seriesCount = result.telemetry?.series.length ?? 0;
  return `${seriesCount} 个遥测序列，${telemetryRecordCount} 条遥测记录，${imageCount} 张图片`;
}

function formatTelemetryValue(value: number): string {
  if (!Number.isFinite(value)) {
    return "-";
  }
  return Number.isInteger(value) ? String(value) : value.toFixed(4).replace(/0+$/, "").replace(/\.$/, "");
}

function streamTypeLabel(type: DataStream["type"]): string {
  switch (type) {
    case "telemetry":
      return "遥测";
    case "image":
      return "图片";
    case "video":
      return "视频";
    case "audio":
      return "音频";
    case "event":
      return "事件";
    case "log":
      return "日志";
    default:
      return type;
  }
}
