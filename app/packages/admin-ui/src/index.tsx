import type { ReactNode } from "react";
import { App, ConfigProvider, theme } from "antd";

export function AdminProvider({ children }: { children: ReactNode }) {
  return <ConfigProvider theme={{ algorithm: theme.defaultAlgorithm, token: { colorPrimary: "#1769e0", borderRadius: 6, colorBgLayout: "#f4f7fa", fontFamily: "-apple-system, SF Pro Text, PingFang SC, Noto Sans SC, sans-serif" }, components: { Table: { headerBg: "#f7fafc", cellPaddingBlock: 13 }, Button: { controlHeight: 36 } } }}><App>{children}</App></ConfigProvider>;
}

export { Table, Form, Input, InputNumber, Select, Modal, Drawer, Tabs, Tag, Card, Statistic, Empty, Alert, Space, Popconfirm, Button } from "antd";
