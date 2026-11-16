import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, App, Button, Card, Descriptions, Space, Table, Tag, Tooltip, Typography } from "antd";
import { api, formatApiError, type LoRaWANNodeDiscovery } from "@thcpn/api";
import { opsTime } from "./admin-device-ops-model";

const reasonLabels = {
  slot_occupied: "序号已有其他节点",
  node_bound_elsewhere: "节点已安装在其他位置",
  manually_unbound: "曾解绑，需要重新确认",
};

function isBoundElsewhere(item: LoRaWANNodeDiscovery) {
  return item.bound_gateway_sn != null && (
    item.bound_gateway_sn !== item.gateway_sn || item.bound_node_index !== item.node_index
  );
}

const pageSize = 20;
export const nodeDiscoveriesKey = (deviceId: string) => ["admin", "device", deviceId, "node-discoveries"] as const;

export function AdminNodeDiscoveries({ deviceId }: { deviceId: string }) {
  const { modal, message } = App.useApp();
  const client = useQueryClient();
  const [page, setPage] = useState(1);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ type: "warning" | "error"; text: string } | null>(null);
  const query = useQuery({
    queryKey: [...nodeDiscoveriesKey(deviceId), page],
    queryFn: () => api.admin.nodeDiscoveries(deviceId, page, pageSize),
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    refetchOnMount: "always",
    retry: false,
  });
  const total = query.data?.pagination.total_count ?? 0;
  useEffect(() => {
    if (query.data && page > 1 && !query.data.data.length) {
      setPage(Math.max(1, query.data.pagination.total_page));
    }
  }, [query.data, page]);
  const refresh = () => client.invalidateQueries({
    predicate: q => q.queryKey[0] === "admin" && (
      q.queryKey.includes(deviceId) || q.queryKey.includes("devices") || q.queryKey.includes("node-inventory")
    ),
  });

  const confirm = (item: LoRaWANNodeDiscovery) => {
    const replacing = Boolean(item.current_node_sn && item.current_node_sn.toLowerCase() !== item.node_sn.toLowerCase());
    modal.confirm({
      title: replacing ? "确认更换为上报节点" : "确认安装上报节点",
      cancelText: "取消",
      okText: replacing ? "确认更换" : "确认安装",
      content: <Space orientation="vertical" size="middle" style={{ width: "100%" }}>
        <Descriptions column={1} size="small" items={[
          { key: "gateway", label: "网关", children: item.gateway_sn },
          { key: "index", label: "序号", children: item.node_index },
          ...(replacing ? [{ key: "previous", label: "原节点 SN", children: item.current_node_sn }] : []),
          { key: "reported", label: "上报节点 SN", children: item.node_sn },
        ]} />
        <Typography.Paragraph style={{ margin: 0 }}>沿用原名称、坐标、配置及该序号的历史数据。确认后只更新节点绑定，不向设备下发配置。</Typography.Paragraph>
      </Space>,
      onOk: async () => {
        setBusy(true);
        setFeedback(null);
        try {
          const result = await api.admin.changePhysicalNode(deviceId, {
            action: replacing ? "replace" : "bind",
            sn: item.node_sn,
            node_index: item.node_index,
          });
          if (result.status === "completed") {
            void message.success(replacing ? "节点已更换" : "节点已安装");
          } else {
            setFeedback({ type: "warning", text: String(result.message || "源端已接受，平台同步待完成，请刷新核对。") });
          }
          await refresh();
        } catch (error) {
          setFeedback({ type: "error", text: formatApiError(error).message });
          await refresh();
        } finally {
          setBusy(false);
        }
      },
    });
  };

  // Automatic, unambiguous discoveries already appear in the ordinary node list.
  if (!query.isLoading && !query.error && !total && !feedback) return null;

  return <Card size="small" title={<Space>待确认节点<Tag color="orange">{total}</Tag></Space>}
    extra={<Button loading={query.isFetching} disabled={busy} onClick={() => void query.refetch()}>刷新发现</Button>}>
    <Space orientation="vertical" size="middle" style={{ width: "100%" }}>
      {query.error && <Alert type="error" title="节点发现读取失败" description={formatApiError(query.error).message} />}
      {feedback && <Alert type={feedback.type} title={feedback.text} closable onClose={() => setFeedback(null)} />}
      <Table<LoRaWANNodeDiscovery> rowKey="id" size="small" loading={query.isFetching} dataSource={query.data?.data ?? []}
        scroll={{ x: 860 }} locale={{ emptyText: "暂无待确认节点" }}
        pagination={{ current: page, pageSize, total, showSizeChanger: false, onChange: setPage }}
        columns={[
          { title: "序号", dataIndex: "node_index", width: 65 },
          { title: "上报节点 SN", dataIndex: "node_sn", render: sn => <Typography.Text copyable>{sn}</Typography.Text> },
          { title: "当前节点 SN", dataIndex: "current_node_sn", render: sn => sn || "—" },
          { title: "待确认原因", render: (_, item) => <Space orientation="vertical" size={2}>
            <Tag color="orange">{isBoundElsewhere(item) ? reasonLabels.node_bound_elsewhere : item.reason ? reasonLabels[item.reason] : "绑定待确认"}</Tag>
            {isBoundElsewhere(item) && <Typography.Text>{item.bound_gateway_sn} · 序号 {item.bound_node_index}</Typography.Text>}
          </Space> },
          { title: "最近接收", dataIndex: "last_seen_at", render: opsTime },
          { title: "操作", width: 100, render: (_, item) => {
            const elsewhere = isBoundElsewhere(item);
            return <Tooltip title={elsewhere ? "请先核实安装位置，并在原网关解绑节点" : undefined}>
              <span><Button size="small" disabled={busy || elsewhere} onClick={() => confirm(item)}>
                {item.current_node_sn && item.current_node_sn.toLowerCase() !== item.node_sn.toLowerCase() ? "确认更换" : "确认安装"}
              </Button></span>
            </Tooltip>;
          } },
        ]} />
    </Space>
  </Card>;
}
