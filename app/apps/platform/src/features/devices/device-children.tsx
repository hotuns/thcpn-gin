import { RuntimeStatusCards } from "./runtime-status";
import { nodeSnapshot, nodeStatusKeys, isMeasurement } from "@thcpn/api";
import { useState } from "react";
import { useIsMobile } from "../../shared/hooks/use-mobile";
import "./device-mobile.css";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api, formatApiError } from "@thcpn/api";
import { workspaceQueryKey } from "@thcpn/workspace";
import { Button, StateView } from "../../shared/ui";
import { NodeVitals, useNodeRuntime } from "./node-vitals";

export function DeviceChildren({
  workspaceId,
  deviceId,
  onData,
  lora=false,
}: {
  workspaceId: string;
  deviceId: string;
  onData: (id?: string) => void;
  lora?:boolean;
}) {
  const mobile = useIsMobile();
  const [page,setPage]=useState(1);
  const query = useQuery({
    queryKey: workspaceQueryKey(workspaceId, "device", deviceId, "nodes"),
    queryFn: () => api.devices.nodes(deviceId),
  });
  const pageCount=Math.max(1,Math.ceil((query.data?.items.length??0)/20));
  const currentPage=Math.min(page,pageCount);
  const nodes=lora?(query.data?.items??[]).slice((currentPage-1)*20,currentPage*20):(query.data?.items??[]);
  const runtime=useNodeRuntime(workspaceId,deviceId,lora?nodes.flatMap(node=>node.target.kind==="gateway_node"?[node.target.node_index]:[]):undefined);
  if (query.isLoading)
    return (
      <StateView
        type="loading"
        title="正在加载子节点"
        description="正在读取网关拓扑。"
      />
    );
  if (query.error)
    return (
      <StateView
        type="error"
        title="子节点加载失败"
        description={formatApiError(query.error).message}
        requestId={formatApiError(query.error).requestId}
      />
    );
  if (!query.data?.items.length)
    return (
      <StateView
        type="empty"
        title="没有可见子节点"
        description="当前网关尚未配置节点，或没有可访问的节点。"
      />
    );
  return (
    <div className="child-device-list child-device-list-expanded">
      {lora&&<div className="header-actions"><Button variant="secondary" onClick={()=>void runtime.refetch()}>刷新状态</Button>{pageCount>1&&<><Button disabled={currentPage===1} onClick={()=>setPage(currentPage-1)}>上一页</Button><span>{currentPage} / {pageCount}</span><Button disabled={currentPage===pageCount} onClick={()=>setPage(currentPage+1)}>下一页</Button></>}</div>}
      {nodes.map((node) => {
        const runtimeView = lora?<RuntimeStatusCards deviceId={deviceId} workspaceId={workspaceId} name={node.name} sn={node.node_sn} keys={nodeStatusKeys} snapshot={nodeSnapshot(runtime.data?.items.find(item=>item.key===node.key))} loading={runtime.isFetching} error={runtime.error?formatApiError(runtime.error).message:undefined}/>:<NodeVitals item={runtime.data?.items.find(item => item.key === node.key)} loading={runtime.isLoading} error={runtime.isError}/>;
        return (
        <div key={node.key} className="child-device-row">
          <div>
            <div className="cell-title">{node.name}</div>
            <div className="cell-sub">
              {node.streams.filter(isMeasurement).length ? `${node.streams.filter(isMeasurement).length} 个指标` : "暂无指标"}
            </div>
            {lora&&<div className="cell-sub">SN {node.node_sn} · 序号 {node.target.kind==="gateway_node"?node.target.node_index:"—"}</div>}
          </div>
          <div className="child-device-runtime">
            {mobile ? <details className="device-node-status"><summary>运行状态</summary>{runtimeView}</details> : runtimeView}
          </div>
          <div>
            {node.target.kind === "device" ? (
              <Button variant="secondary" onClick={() => onData(node.target.kind === "device" ? node.target.device_id : undefined)}>
                查看数据
              </Button>
            ) : (
              <Button variant="secondary" asChild><Link to={`/devices/${encodeURIComponent(deviceId)}?tab=data&node=${encodeURIComponent(node.key)}`}>
                查看数据
              </Link></Button>
            )}
          </div>
        </div>
      ); })}
    </div>
  );
}
