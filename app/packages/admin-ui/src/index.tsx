import type { ReactNode } from "react";
import { App, ConfigProvider, theme } from "antd";
import zhCN from "antd/locale/zh_CN";
import enUS from "antd/locale/en_US";
import { useLocale, useTheme } from "@thcpn/i18n";

export function AdminProvider({ children }: { children: ReactNode }) {
  const { locale } = useLocale();
  const { resolvedTheme } = useTheme();
  const dark = resolvedTheme === "dark";
  return <ConfigProvider locale={locale === "zh-CN" ? zhCN : enUS} theme={{ algorithm: dark ? theme.darkAlgorithm : theme.defaultAlgorithm, token: { colorPrimary: "#1769e0", borderRadius: 6, colorBgLayout: dark ? "#0d151d" : "#f4f7fa", fontFamily: "-apple-system, SF Pro Text, PingFang SC, Noto Sans SC, sans-serif" }, components: { Table: { headerBg: dark ? "#121c26" : "#f7fafc", cellPaddingBlock: 13 }, Button: { controlHeight: 36 } } }}><App>{children}</App></ConfigProvider>;
}

export { Table, Form, Input, InputNumber, Select, DatePicker, Modal, Drawer, Tabs, Tag, Card, Statistic, Progress, Empty, Alert, Space, Popconfirm, Button, Segmented, Descriptions, Tooltip, App } from "antd";
