import { useLayoutEffect, useRef, useState, type Dispatch, type Key, type SetStateAction } from "react";
import { Outlet, useLocation, useMatch, useOutletContext } from "react-router-dom";
import type { JsonRecord } from "@thcpn/api";

export const deviceSortOptions = [
  { value: "created_desc", label: "创建时间：最新优先" },
  { value: "created_asc", label: "创建时间：最早优先" },
  { value: "name_asc", label: "设备名称：正序" },
  { value: "name_desc", label: "设备名称：倒序" },
  { value: "asset_asc", label: "资产编号：正序" },
  { value: "asset_desc", label: "资产编号：倒序" },
] as const;
export type DeviceSort = typeof deviceSortOptions[number]["value"];

type DeviceListView = {
  category: string;
  keyword: string;
  status: string;
  lifecycle: string;
  assignment: string;
  sort: DeviceSort;
  page: number;
  pageSize: number;
  selectedRowKeys: Key[];
  expandedRowKeys: Key[];
};

export type NodeInventoryView = {
  sourceParam: string;
  gatewayParam: string;
  bound: string;
  search: string;
  sn: string;
  page: number;
  gatewayId: string;
};

type DeviceListContext = {
  view: DeviceListView;
  setView: Dispatch<SetStateAction<DeviceListView>>;
  children: Record<string, JsonRecord[]>;
  setChildren: Dispatch<SetStateAction<Record<string, JsonRecord[]>>>;
  nodeInventoryView: NodeInventoryView | undefined;
  setNodeInventoryView: Dispatch<SetStateAction<NodeInventoryView | undefined>>;
  listPath: string | null;
};

export function AdminDeviceListLayout() {
  const [view, setView] = useState<DeviceListView>({
    category: "standalone",
    keyword: "", status: "", lifecycle: "", assignment: "", sort: "created_desc",
    page: 1, pageSize: 20, selectedRowKeys: [], expandedRowKeys: [],
  });
  const [children, setChildren] = useState<Record<string, JsonRecord[]>>({});
  const [nodeInventoryView, setNodeInventoryView] = useState<NodeInventoryView>();
  const [listPath, setListPath] = useState<string | null>(null);
  const scrollTop = useRef(0);
  const { pathname, search } = useLocation();
  const isList = Boolean(useMatch("/admin/devices"));

  useLayoutEffect(() => {
    if (!isList) return;
    const category = new URLSearchParams(search).get("kind") || "standalone";
    setView(current => current.category === category ? current
      : { ...current, category, page: 1, selectedRowKeys: [], expandedRowKeys: [] });
    setListPath(pathname + search);
  }, [isList, pathname, search]);

  useLayoutEffect(() => {
    if (!isList) {
      window.scrollTo({ top: 0, behavior: "instant" });
      return;
    }
    window.scrollTo({ top: scrollTop.current, behavior: "instant" });
    const rememberScroll = () => { scrollTop.current = window.scrollY; };
    window.addEventListener("scroll", rememberScroll, { passive: true });
    return () => window.removeEventListener("scroll", rememberScroll);
  }, [isList, pathname]);

  return <Outlet context={{ view, setView, children, setChildren, nodeInventoryView, setNodeInventoryView, listPath } satisfies DeviceListContext} />;
}

export function useAdminDeviceListState() {
  return useOutletContext<DeviceListContext>();
}
