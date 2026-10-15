import type { ReactNode, ButtonHTMLAttributes } from "react";
import { App, Button as AntButton, ConfigProvider, theme } from "antd";
import { CloseOutlined } from "@ant-design/icons";
import zhCN from "antd/locale/zh_CN";
import enUS from "antd/locale/en_US";
import { useLocale, useTheme } from "@thcpn/i18n";

export const adminButtonTokens = { controlHeight: 36, controlHeightSM: 28, controlHeightLG: 44, borderRadius: 6, borderRadiusSM: 6, borderRadiusLG: 6, paddingInline: 14, paddingInlineSM: 10, fontWeight: 500, autoInsertSpace: false };

export function IconButton({ label, children, ...props }: Omit<ButtonHTMLAttributes<HTMLButtonElement>, "color"> & { label: string }) {
  return <AntButton {...props} htmlType={props.type ?? "button"} type="text" aria-label={label} title={label} icon={children} className={`admin-icon-button ${props.className ?? ""}`}/>;
}
export function CloseButton(props: Omit<ButtonHTMLAttributes<HTMLButtonElement>, "color">) {
  const { locale } = useLocale();
  return <IconButton {...props} label={locale === "zh-CN" ? "关闭" : "Close"}><CloseOutlined/></IconButton>;
}

export function AdminProvider({ children }: { children: ReactNode }) {
  const { locale } = useLocale();
  const { resolvedTheme } = useTheme();
  const dark = resolvedTheme === "dark";
  return <ConfigProvider locale={locale === "zh-CN" ? zhCN : enUS} theme={{ algorithm: dark ? theme.darkAlgorithm : theme.defaultAlgorithm, token: { colorPrimary: "#1769e0", borderRadius: 6, colorBgLayout: dark ? "#0d151d" : "#f4f7fa", fontFamily: "var(--font-family-ui)", fontSize: 14, fontSizeSM: 12, fontSizeLG: 16, fontSizeHeading1: 28, fontSizeHeading2: 24, fontSizeHeading3: 20, fontSizeHeading4: 18, fontSizeHeading5: 16, fontWeightStrong: 600, lineHeight: 1.6 }, components: { Table: { headerBg: dark ? "#121c26" : "#f7fafc", cellPaddingBlock: 13 }, Button: adminButtonTokens } }}><App>{children}</App></ConfigProvider>;
}

export { Pagination, Table, Form, Input, InputNumber, Select, DatePicker, Modal, Drawer, Tabs, Tag, Card, Collapse, Statistic, Progress, Spin, Empty, Alert, Space, Popconfirm, Button, Checkbox, Segmented, Descriptions, Tooltip, Upload, App } from "antd";
