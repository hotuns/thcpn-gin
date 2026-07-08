import { Card, Typography } from "antd";
import type { ReactNode } from "react";

interface PageProps {
  title: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
}

export function Page({ title, actions, children }: PageProps) {
  return (
    <section className="page">
      <header className="page-header">
        <div>
          <Typography.Title level={2}>{title}</Typography.Title>
        </div>
        {actions ? <div className="page-actions">{actions}</div> : null}
      </header>
      {children}
    </section>
  );
}

export function Section({ title, children, actions }: PageProps) {
  return (
    <Card className="section" title={<Typography.Text strong>{title}</Typography.Text>} extra={actions}>
      {children}
    </Card>
  );
}
