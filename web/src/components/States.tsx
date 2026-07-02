import { Alert, Button, Empty, Result, Spin, Space } from "antd";
import { formatApiError } from "../api";

export function LoadingState({ label = "正在加载" }: { label?: string }) {
  return (
    <Space className="state state-inline">
      <Spin size="small" />
      <span>{label}</span>
    </Space>
  );
}

export function EmptyState({ title, detail }: { title: string; detail?: string }) {
  return <Empty className="state" description={detail || title} image={Empty.PRESENTED_IMAGE_SIMPLE} />;
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const description = formatApiError(error);
  return (
    <Result
      className="state state-error"
      extra={onRetry ? <Button onClick={onRetry}>重试</Button> : null}
      status="warning"
      subTitle={<Alert message={description} showIcon type="error" />}
      title="请求未完成"
    />
  );
}
