import type { ReactNode } from "react";
import { EmptyState } from "./States";

export interface Column<T> {
  key: string;
  header: string;
  render: (item: T) => ReactNode;
  className?: string;
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
  if (items.length === 0) {
    return <EmptyState title={empty} detail="当前筛选范围没有可显示的数据。" />;
  }

  return (
    <div className="table-scroll">
      <table className="data-table">
        <thead>
          <tr>
            {columns.map((column) => (
              <th className={column.className} key={column.key}>
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={getRowKey(item)}>
              {columns.map((column) => (
                <td className={column.className} key={column.key}>
                  {column.render(item)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
