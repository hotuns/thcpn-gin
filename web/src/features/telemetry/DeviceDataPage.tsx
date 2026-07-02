import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
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
  DatePicker,
  Descriptions,
  Empty,
  Form,
  Image,
  InputNumber,
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
  devicesApi,
  formatApiError,
  mediaApi,
  telemetryApi,
  type DataStream,
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

const ALL_STREAMS = "__all__";
const IMAGE_PAGE_SIZE_LIMIT = 100;
const RESULT_TAB_DATA = "data";
const RESULT_TAB_IMAGES = "images";

use([LineChart, GridComponent, TooltipComponent, LegendComponent, DataZoomComponent, CanvasRenderer]);

interface QueryFormState {
  deviceId: string;
  dataStreamId: string;
  range: [Dayjs, Dayjs] | null;
  limit: number;
}

interface DeviceDataQueryInput {
  deviceId: string;
  dataStreamId: string;
  streamType: "all" | "telemetry" | "image";
  startTime: string;
  endTime: string;
  limit: number;
  includeTelemetry: boolean;
  includeImages: boolean;
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

export function DeviceDataPage() {
  const { selectedWorkspaceId, selectedWorkspace } = useWorkspace();
  const { message } = AntApp.useApp();
  const [activeResultTab, setActiveResultTab] = useState(RESULT_TAB_DATA);
  const [form, setForm] = useState<QueryFormState>({
    deviceId: "",
    dataStreamId: ALL_STREAMS,
    range: [dayjs().subtract(24, "hour"), dayjs()],
    limit: 500
  });

  const devices = useQuery({
    queryKey: ["devices", selectedWorkspaceId],
    queryFn: () => devicesApi.list({ workspace_id: selectedWorkspaceId }),
    enabled: Boolean(selectedWorkspaceId)
  });

  const selectedDevice = useMemo(
    () => devices.data?.items.find((device) => device.id === form.deviceId),
    [devices.data?.items, form.deviceId]
  );

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
    () => visibleStreams.find((stream) => stream.id === form.dataStreamId),
    [form.dataStreamId, visibleStreams]
  );
  const streamsByID = useMemo(() => new Map(visibleStreams.map((stream) => [stream.id, stream])), [visibleStreams]);

  const query = useMutation({
    mutationFn: async (input: DeviceDataQueryInput): Promise<DeviceDataQueryResult> => {
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

      if (input.streamType === "telemetry") {
        return { telemetry: await telemetryApi.queryDataStream(input.dataStreamId, telemetryParams) };
      }
      if (input.streamType === "image") {
        return { media: await mediaApi.listDataStream(input.dataStreamId, mediaParams) };
      }

      const [telemetry, media] = await Promise.all([
        input.includeTelemetry ? telemetryApi.queryDevice(input.deviceId, telemetryParams) : Promise.resolve(undefined),
        input.includeImages ? mediaApi.listDeviceImages(input.deviceId, mediaParams) : Promise.resolve(undefined)
      ]);
      return { telemetry, media };
    }
  });

  const telemetryResult = query.data?.telemetry;
  const mediaResult = query.data?.media;
  const rows = useMemo(() => flattenTelemetryRows(telemetryResult), [telemetryResult]);
  const warnings = useMemo(() => collectWarnings(telemetryResult), [telemetryResult]);
  const mediaItems = mediaResult?.items ?? [];
  const deviceOptions = useMemo(
    () => (devices.data?.items ?? []).map((device) => ({ label: `${device.name} · ${device.serial_no}`, value: device.id })),
    [devices.data?.items]
  );
  const streamOptions = useMemo(
    () => [
      { label: `全部数据 · 遥测 ${telemetryStreams.length} · 图片 ${imageStreams.length}`, value: ALL_STREAMS },
      ...visibleStreams.map((stream) => ({
        label: `${streamTypeLabel(stream.type)} · ${stream.name} · ${stream.code}${stream.unit ? ` · ${stream.unit}` : ""}`,
        value: stream.id
      }))
    ],
    [imageStreams.length, telemetryStreams.length, visibleStreams]
  );

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
    setForm((current) => ({
      ...current,
      deviceId,
      dataStreamId: ALL_STREAMS
    }));
    query.reset();
  }

  function handleDataStreamChange(dataStreamId: string) {
    setForm((current) => ({ ...current, dataStreamId }));
    query.reset();
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

    const streamType = resolveQueryStreamType(form.dataStreamId, selectedStream);
    if (!streamType) {
      void message.warning("当前只支持查询遥测数据和图片数据");
      return;
    }

    query.mutate({
      deviceId: form.deviceId,
      dataStreamId: form.dataStreamId,
      streamType,
      startTime: form.range[0].toISOString(),
      endTime: form.range[1].toISOString(),
      limit: form.limit,
      includeTelemetry: telemetryStreams.length > 0,
      includeImages: imageStreams.length > 0
    });
  }

  return (
    <section className="page device-data-page">
      <header className="page-header">
        <div>
          <Typography.Title level={2}>设备数据查询</Typography.Title>
          <Typography.Paragraph type="secondary">
            按设备、数据流和时间范围读取遥测趋势和图片记录。遥测以 ECharts 展示，图片支持点击预览。
          </Typography.Paragraph>
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
        <div className="form-grid">
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
          <Form.Item className="field" label="数据流">
            <Select
              className="control"
              disabled={!form.deviceId || streams.isLoading}
              loading={streams.isLoading}
              onChange={handleDataStreamChange}
              options={streamOptions}
              placeholder="选择数据流"
              showSearch
              optionFilterProp="label"
              value={form.dataStreamId}
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

        <div className="query-actions">
          <Button
            disabled={!form.deviceId || !form.range || streams.isLoading}
            icon={<SearchOutlined />}
            loading={query.isPending}
            onClick={handleQuery}
            type="primary"
          >
            查询数据
          </Button>
          <Typography.Text type="secondary">
            {selectedWorkspace ? selectedWorkspace.workspace.name : "未选择工作区"}
          </Typography.Text>
        </div>

        {!devices.isLoading && devices.data?.items.length === 0 ? (
          <Alert className="query-alert" message="当前工作区没有设备。先在设备页创建设备，或由系统管理员在后台同步 THCPN 标准站。" showIcon type="info" />
        ) : null}
        {streams.error ? <Alert className="query-alert" message={formatApiError(streams.error)} showIcon type="error" /> : null}
        {query.error ? <Alert className="query-alert" message={formatApiError(query.error)} showIcon type="error" /> : null}
      </Card>

      <Card className="section" title="查询上下文">
        <Descriptions bordered column={{ lg: 4, md: 2, sm: 1, xs: 1 }} size="small">
          <Descriptions.Item label="设备">{describeDevice(selectedDevice)}</Descriptions.Item>
          <Descriptions.Item label="数据流">{describeStreamScope(form.dataStreamId, selectedStream, telemetryStreams.length, imageStreams.length)}</Descriptions.Item>
          <Descriptions.Item label="时间范围">{describeRange(form.range)}</Descriptions.Item>
          <Descriptions.Item label="结果">{describeQueryResult(query.data, rows.length, mediaItems.length, form.limit)}</Descriptions.Item>
        </Descriptions>
      </Card>

      <Card
        className="section"
        title={
          <Space orientation="vertical" size={0}>
            <Typography.Text strong>查询结果</Typography.Text>
            <Typography.Text type="secondary">{describeResultSummary(query.data, rows.length, mediaItems.length)}</Typography.Text>
          </Space>
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
                  locale={{ emptyText: "这个时间范围内没有可显示的数据点" }}
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
    </section>
  );
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
              <Tag>{series.points.length} 点</Tag>
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
    return <Empty className="telemetry-chart-empty" description="这个时间范围内没有可绘制的数据点" image={Empty.PRESENTED_IMAGE_SIMPLE} />;
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

function resolveQueryStreamType(dataStreamId: string, selectedStream?: DataStream): DeviceDataQueryInput["streamType"] | undefined {
  if (dataStreamId === ALL_STREAMS) {
    return "all";
  }
  if (selectedStream?.type === "telemetry" || selectedStream?.type === "image") {
    return selectedStream.type;
  }
  return undefined;
}

function describeDevice(device?: Device): string {
  if (!device) {
    return "-";
  }
  return `${device.name} · ${device.serial_no}`;
}

function describeStreamScope(dataStreamId: string, selectedStream: DataStream | undefined, telemetryCount: number, imageCount: number): string {
  if (dataStreamId === ALL_STREAMS) {
    return `全部数据 (遥测 ${telemetryCount}，图片 ${imageCount})`;
  }
  if (!selectedStream) {
    return "-";
  }
  return `${streamTypeLabel(selectedStream.type)} · ${selectedStream.name} · ${selectedStream.code}`;
}

function describeRange(range: [Dayjs, Dayjs] | null): string {
  if (!range) {
    return "-";
  }
  return `${range[0].format("YYYY-MM-DD HH:mm:ss")} - ${range[1].format("YYYY-MM-DD HH:mm:ss")}`;
}

function describeQueryResult(result: DeviceDataQueryResult | undefined, pointCount: number, imageCount: number, limit: number): string {
  if (!result) {
    return `上限 ${limit}`;
  }
  return `${pointCount} 个点，${imageCount} 张图片`;
}

function describeResultSummary(result: DeviceDataQueryResult | undefined, pointCount: number, imageCount: number): string {
  if (!result) {
    return "提交查询后显示趋势图和图片";
  }
  const seriesCount = result.telemetry?.series.length ?? 0;
  return `${seriesCount} 个遥测序列，${pointCount} 个数据点，${imageCount} 张图片`;
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
