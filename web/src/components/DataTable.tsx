import { Table } from "antd";
import type { TableColumnsType } from "antd";
import type { ReactNode } from "react";

export interface Column<T> {
  key: string;
  header: string;
  render: (item: T) => ReactNode;
  className?: string;
  width?: number;
}

export function DataTable<T>({
  columns,
  empty,
  getRowKey,
  items
}: {
  columns: Column<T>[];
  empty: string;
  getRowKey: (item: T) => string;
  items: T[];
}) {
  const tableWidth = columns.reduce((sum, column) => sum + (column.width ?? defaultColumnWidth(column.key)), 0);
  const tableColumns: TableColumnsType<T> = columns.map((column) => ({
    className: column.className,
    ellipsis: true,
    key: column.key,
    render: (_, record) => column.render(record),
    title: column.header,
    width: column.width ?? defaultColumnWidth(column.key)
  }));

  return (
    <Table<T>
      className="data-table"
      columns={tableColumns}
      dataSource={items}
      locale={{ emptyText: empty }}
      pagination={false}
      rowKey={getRowKey}
      scroll={{ x: tableWidth }}
      size="middle"
      tableLayout="fixed"
    />
  );
}

function defaultColumnWidth(key: string): number {
  if (key === "id" || key.endsWith("_id") || key === "request" || key === "resource") {
    return 240;
  }
  if (key === "actions" || key === "action" || key === "status" || key === "result") {
    return 130;
  }
  if (key === "created" || key === "updated" || key === "expires" || key === "time") {
    return 180;
  }
  if (key === "name" || key === "subject" || key === "target") {
    return 220;
  }
  return 170;
}
