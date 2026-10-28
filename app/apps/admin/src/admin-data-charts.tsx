import { useEffect, useMemo, useState } from "react";
import { Alert, Button, Card, Col, Empty, Modal, Pagination, Row, Space, Spin, Typography, theme } from "antd";
import { Bar, Brush, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Scatter, Tooltip, XAxis, YAxis } from "recharts";
import { adminChartNumber, adminChartTime, prepareAdminCurve, type AdminChartSeries } from "./admin-chart-model";
import { opsTime } from "./admin-device-ops-model";

export function AdminDataCharts({ series, loading = false }: { series: AdminChartSeries[]; loading?: boolean }) {
  const [page, setPage] = useState(1);
  const [expandedId, setExpandedId] = useState<string>();
  const currentPage = Math.min(page, Math.max(1, Math.ceil(series.length / 6)));
  const expanded = series.find(item => item.id === expandedId);
  useEffect(() => {
    if (expandedId && !expanded) setExpandedId(undefined);
  }, [expandedId, expanded]);
  return <Spin spinning={loading} tip="正在加载数据曲线…">
    <Space orientation="vertical" size="middle" style={{ width: "100%" }}>
      <Typography.Text type="secondary">展示当前查询返回的原始数据，不重新采样。拖动图表底部滑块可缩放时间范围，悬停查看北京时间与数值。</Typography.Text>
      {!series.length ? <Empty description={loading ? "正在读取指标" : "请选择数据指标"} /> : <Row gutter={[16, 16]}>
        {series.slice((currentPage - 1) * 6, currentPage * 6).map((item, index) => <Col key={item.id} xs={24} xl={12}>
          <Card size="small" title={<Typography.Text ellipsis title={item.name}>{item.name}{item.unit ? ` (${item.unit})` : ""}</Typography.Text>} extra={<Button size="small" onClick={() => setExpandedId(item.id)}>放大查看</Button>}>
            <Curve series={item} colorIndex={index} />
          </Card>
        </Col>)}
      </Row>}
      {series.length > 6 && <Pagination current={currentPage} pageSize={6} total={series.length} onChange={setPage} showSizeChanger={false} showTotal={total => `${total} 个指标，每页 6 个`} />}
    </Space>
    <Modal title={expanded ? `${expanded.name}${expanded.unit ? ` (${expanded.unit})` : ""} · 数据曲线` : "数据曲线"} open={!!expanded} onCancel={() => setExpandedId(undefined)} footer={null} width="80vw" destroyOnHidden styles={{ body: { maxHeight: "78vh", overflowY: "auto" } }}>
      {expanded && <Curve series={expanded} colorIndex={series.indexOf(expanded) % 6} expanded />}
    </Modal>
  </Spin>;
}

function Curve({ series, colorIndex, expanded = false }: { series: AdminChartSeries; colorIndex: number; expanded?: boolean }) {
  const { token } = theme.useToken();
  const prepared = useMemo(() => prepareAdminCurve(series.points), [series.points]);
  const color = [token.colorPrimary, token.colorSuccess, token.colorWarning, token.purple, token.cyan, token.magenta][colorIndex % 6];
  const code = series.code?.trim().toLowerCase();
  const direction = ["wind_d", "wind_direction", "winddir"].includes(code ?? "");
  const rainfall = ["rain", "rainfall"].includes(code ?? "");
  return <>
    <Space wrap size="middle" style={{ marginBottom: 12 }}>
      {series.code && <Typography.Text type="secondary">{series.code}</Typography.Text>}
      <Typography.Text>有效记录 {prepared.count}</Typography.Text>
      <Typography.Text>最新 <strong>{adminChartNumber(prepared.latest?.value)}</strong></Typography.Text>
      <Typography.Text type="secondary">最小 {adminChartNumber(prepared.minimum)} · 最大 {adminChartNumber(prepared.maximum)}</Typography.Text>
    </Space>
    {prepared.rejectedTimes > 0 && <Alert type="warning" title={`${prepared.rejectedTimes} 条记录时间无效，未绘制；请检查原始数据。`} style={{ marginBottom: 12 }} />}
    {!prepared.count ? <Empty description="当前时间范围没有有效数据" /> : <div style={{ height: expanded ? "58vh" : 280, minHeight: expanded ? 360 : 280, width: "100%" }} role="img" aria-label={`${series.name}数据曲线`}>
      <ResponsiveContainer width="100%" height="100%" minWidth={0}>
        <ComposedChart data={prepared.data} margin={{ top: 12, right: 24, bottom: 8, left: 16 }}>
          <CartesianGrid vertical={false} stroke={token.colorBorderSecondary} strokeDasharray="3 4" />
          <XAxis dataKey="time" type="number" domain={["dataMin", "dataMax"]} tickFormatter={adminChartTime} minTickGap={48} tick={{ fill: token.colorTextSecondary, fontSize: 11 }} tickLine={false} axisLine={{ stroke: token.colorBorder }} />
          <YAxis width="auto" tickMargin={10} tickFormatter={value => adminChartNumber(Number(value))} domain={direction ? [0, 360] : ["auto", "auto"]} ticks={direction ? [0, 90, 180, 270, 360] : undefined} tick={{ fill: token.colorTextSecondary, fontSize: 11 }} tickLine={false} axisLine={false} />
          <Tooltip labelFormatter={(value, payload) => {const time = Number(payload[0]?.payload?.time ?? value); return Number.isFinite(time) ? opsTime(new Date(time).toISOString()) : "—";}} formatter={(value, _name, item) => item.dataKey === "time" ? null : [`${adminChartNumber(Number(value))}${series.unit ? ` ${series.unit}` : ""}`, series.name]} contentStyle={{ background: token.colorBgElevated, color: token.colorText, borderColor: token.colorBorder, borderRadius: token.borderRadius, boxShadow: token.boxShadowSecondary }} labelStyle={{ color: token.colorTextSecondary }} />
          {direction ? <Scatter dataKey="value" name={series.name} fill={color} isAnimationActive={false} />
            : rainfall ? <Bar dataKey="value" name={series.name} fill={color} maxBarSize={18} isAnimationActive={false} />
              : <Line dataKey="value" type="linear" name={series.name} stroke={color} strokeWidth={1.7} connectNulls={false} dot={prepared.count <= 40 ? { r: 2 } : false} activeDot={{ r: 4 }} isAnimationActive={false} />}
          {prepared.data.length > 1 && <Brush dataKey="time" height={24} travellerWidth={8} ariaLabel={`${series.name}时间范围缩放`} tickFormatter={value => adminChartTime(Number(value)).slice(-5)} stroke={color} fill={token.colorBgContainer} />}
        </ComposedChart>
      </ResponsiveContainer>
    </div>}
    {prepared.latest && <Typography.Text type="secondary" style={{ fontSize: 12 }}>最新有效记录：{opsTime(new Date(prepared.latest.time).toISOString())}</Typography.Text>}
  </>;
}
