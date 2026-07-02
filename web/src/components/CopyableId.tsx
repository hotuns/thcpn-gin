import { Typography } from "antd";

export function CopyableId({ value }: { value?: string }) {
  if (!value) {
    return <span className="muted">-</span>;
  }

  return (
    <Typography.Text className="copyable-id mono" copyable={{ text: value, tooltips: ["复制 ID", "已复制"] }} ellipsis title={value}>
      {value}
    </Typography.Text>
  );
}
