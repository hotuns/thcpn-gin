import { useQuery } from "@tanstack/react-query";
import { Navigate, useSearchParams } from "react-router-dom";
import { api } from "@thcpn/api";
import { useWorkspace } from "@thcpn/workspace";
import { DEVICE_LIST_GC_TIME, DEVICE_LIST_STALE_TIME, deviceListQueryKey } from "../../shared/data/device-list-cache";
import { legacyDeviceTarget } from "./device-model";

export function LegacyDeviceDataRedirect() {
  const { currentId } = useWorkspace();
  const [params] = useSearchParams();
  const deviceId = params.get("device") ?? "";
  const devices = useQuery({
    queryKey: deviceListQueryKey(currentId),
    queryFn: () => api.devices.list(currentId!),
    enabled: Boolean(currentId),
    staleTime: DEVICE_LIST_STALE_TIME,
    gcTime: DEVICE_LIST_GC_TIME,
  });
  if (devices.isLoading)
    return <div className="app-loading t-shimmer" data-text="正在打开设备…">正在打开设备…</div>;
  const device = devices.data?.items.find((item) => item.id === deviceId);
  if (!device)
    return (
      <Navigate
        to="/devices?notice=设备不存在、已转移或当前账号无权访问"
        replace
      />
    );
  return <Navigate to={legacyDeviceTarget(device)} replace />;
}
