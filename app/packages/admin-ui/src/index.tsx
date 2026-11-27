import { useEffect, type ReactNode, type ButtonHTMLAttributes } from "react";
import { App, Button as AntButton, ConfigProvider, Modal as StaticModal, message as staticMessage, theme } from "antd";
import type { MessageInstance } from "antd/es/message/interface";
import type { HookAPI as ModalHookAPI } from "antd/es/modal/useModal";
import { CloseOutlined } from "@ant-design/icons";
import zhCN from "antd/locale/zh_CN";
import enUS from "antd/locale/en_US";
import { useLocale, useTheme } from "@thcpn/i18n";

let activeModal: ModalHookAPI | null = null;
let activeMessage: MessageInstance | null = null;

function AdminAppBridge() {
  const { modal, message } = App.useApp();
  useEffect(() => {
    activeModal = modal;
    activeMessage = message;
    return () => {
      if (activeModal === modal) activeModal = null;
      if (activeMessage === message) activeMessage = null;
    };
  }, [modal, message]);
  return null;
}

export function getAdminModal() {
  return activeModal ?? StaticModal;
}

export function getAdminMessage() {
  return activeMessage ?? staticMessage;
}

export const adminButtonTokens = { controlHeight: 36, controlHeightSM: 28, controlHeightLG: 44, borderRadius: 6, borderRadiusSM: 6, borderRadiusLG: 6, paddingInline: 14, paddingInlineSM: 10, fontWeight: 500, autoInsertSpace: false };

function numericMonthLocale(base: typeof enUS, monthFormat: string): typeof enUS {
  const datePicker = base.DatePicker;
  if (!datePicker) return base;
  return {
    ...base,
    DatePicker: { ...datePicker, lang: { ...datePicker.lang, monthFormat } },
  };
}

const adminZhCN = numericMonthLocale(zhCN, "M[月]");
const adminEnUS = numericMonthLocale(enUS, "MM");

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
  return <ConfigProvider locale={locale === "zh-CN" ? adminZhCN : adminEnUS} theme={{ algorithm: dark ? theme.darkAlgorithm : theme.defaultAlgorithm, token: { colorPrimary: "#1769e0", borderRadius: 6, colorBgLayout: dark ? "#0d151d" : "#f4f7fa", fontFamily: "var(--font-family-ui)", fontSize: 14, fontSizeSM: 12, fontSizeLG: 16, fontSizeHeading1: 28, fontSizeHeading2: 24, fontSizeHeading3: 20, fontSizeHeading4: 18, fontSizeHeading5: 16, fontWeightStrong: 600, lineHeight: 1.6 }, components: { Table: { headerBg: dark ? "#121c26" : "#f7fafc", cellPaddingBlock: 13 }, Button: adminButtonTokens } }}><App><AdminAppBridge />{children}</App></ConfigProvider>;
}

export { Pagination, Table, Form, Input, InputNumber, Select, DatePicker, Modal, Drawer, Tabs, Tag, Card, Collapse, Statistic, Progress, Spin, Empty, Alert, Space, Popconfirm, Button, Checkbox, Segmented, Descriptions, Tooltip, Upload, App, Breadcrumb, FloatButton, Typography } from "antd";
