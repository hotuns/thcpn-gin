import { Card, Space, Typography } from "antd";
import type { ReactNode } from "react";

interface PageProps {
  title: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
}

export function Page({ title, description, actions, children }: PageProps) {
  return (
    <section className="page">
      <header className="page-header">
        <div>
          <Typography.Title level={2}>{title}</Typography.Title>
          {description ? <Typography.Paragraph type="secondary">{description}</Typography.Paragraph> : null}
        </div>
        {actions ? <div className="page-actions">{actions}</div> : null}
      </header>
      {children}
    </section>
  );
}

export function Section({ title, description, children, actions }: PageProps) {
  return (
    <Card
      className="section"
      title={
        <Space orientation="vertical" size={0}>
          <Typography.Text strong>{title}</Typography.Text>
          {description ? <Typography.Text type="secondary">{description}</Typography.Text> : null}
        </Space>
      }
      extra={actions}
    >
      {children}
    </Card>
  );
}
