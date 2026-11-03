import "./exports-mobile.css";
import { type ReactNode } from "react";
import { Network, Sprout } from "lucide-react";
import { type JsonRecord } from "@thcpn/api";
import { Button, Tabs, TabsList, TabsTrigger } from "../../shared/ui";
import { validDataRange } from "../../shared/data/data-builder";
import { useLocale } from "@thcpn/i18n";
import { type ExportSystem } from "./export-model";

export function ExportSystemChooser({
  selected,
  onSelect,
}: {
  selected: ExportSystem;
  onSelect: (value: ExportSystem) => void;
}) {
  return (
    <section className="export-system-selector dataset-editor-section">
      <div className="dataset-editor-section-heading"><div className="dataset-step-heading"><span>1</span><div><h2>选择导出类型</h2><p>根据设备体系选择对应的导出方式</p></div></div></div>
      <Tabs value={selected} onValueChange={value => onSelect(value as ExportSystem)}>
      <TabsList className="export-system-tabs" aria-label="选择导出类型">
      {(
        [
          {
            id: "standard",
            title: "标准站导出",
            text: "批量选择独立标准站",
            icon: Sprout,
          },
          {
            id: "group",
            title: "组网站导出",
            text: "按一个组网站选择节点",
            icon: Network,
          },
          {
            id: "carbon",
            title: "碳汇站导出",
            text: "选择 Node × 地块组合",
            icon: Sprout,
          },
        ] as const
      ).map((item) => {
        const Icon = item.icon;
        return (
          <TabsTrigger
            key={item.id}
            value={item.id}
          >
            <Icon size={18} />
            <strong>{item.title}</strong>
          </TabsTrigger>
        );
      })}
      </TabsList>
      </Tabs>
    </section>
  );
}

export type FormCommon = {
  chooser: ReactNode;
  params: URLSearchParams;
  onClose: () => void;
  onCreate: (payload: JsonRecord) => Promise<boolean>;
  feedback?: string;
};

export function FormFooter({
  count,
  busy,
  onClose,
  system,
  start,
  end,
  content,
  label = "创建 ZIP 导出",
  invalid = false,
  feedback,
}: {
  count: number;
  busy: boolean;
  onClose: () => void;
  system: string;
  start: string;
  end: string;
  content: string;
  label?: string;
  invalid?: boolean;
  feedback?: string;
}) {
  const { t } = useLocale();
  const contentKeys: Record<string, string> = { "设备数据和图片": "dataImages", "设备数据": "dataOnly", "通量数据、原始采样": "fluxRaw", "通量数据": "flux", "原始采样": "raw", "图片": "imagesOnly", "未选择": "nothingSelected" };
  return (
    <aside className="export-builder-summary dataset-builder-summary">
      <div className="dataset-builder-summary-heading"><span>3</span><div><h2>检查并创建</h2><p>{t("exportEditor.after")}</p></div></div>
      <dl>
        <div><dt>导出类型</dt><dd>{system}</dd></div>
        <div><dt>导出目标</dt><dd>{count ? t("exportEditor.targets", { count }) : "未选择"}</dd></div>
        <div><dt>时间范围</dt><dd>{start.replace("T", " ")}<span>至</span>{end.replace("T", " ")}</dd></div>
        <div><dt>导出内容</dt><dd>{contentKeys[content] ? t(`exportEditor.${contentKeys[content]}`) : content}</dd></div>
      </dl>
      {feedback && <div className="form-error" role="alert">{feedback}</div>}
      <div className="export-builder-actions mobile-form-actions">
        <Button type="button" variant="secondary" onClick={onClose}>取消</Button>
        <Button type="submit" disabled={busy || count === 0 || invalid || !validDataRange(start, end)}>{busy ? "创建中…" : label}</Button>
      </div>
      <p className="export-review-hint" role="status">{t(busy ? "exportEditor.creating" : !count ? "exportEditor.missing" : invalid ? "exportEditor.invalidSettings" : !validDataRange(start, end) ? "exportEditor.invalidRange" : "exportEditor.ready")}</p>
    </aside>
  );
}
