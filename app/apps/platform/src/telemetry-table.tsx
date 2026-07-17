import { useMemo, useState } from "react";
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
  type SortingState,
} from "@tanstack/react-table";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import type { TelemetrySeries } from "@thcpn/api";
import { IconButton } from "@thcpn/ui";
import { healthyTelemetryQuality } from "./telemetry-charts";

type TelemetryPoint = TelemetrySeries["points"][number] & {
  series: TelemetrySeries;
};
type TelemetryWideRow = {
  ts: string;
  values: Record<string, TelemetryPoint>;
};

export function TelemetryTable({
  points,
  formatTime,
}: {
  points: TelemetryPoint[];
  formatTime: (value?: string) => string;
}) {
  const [sorting, setSorting] = useState<SortingState>([
    { id: "ts", desc: true },
  ]);
  const { rows, streams } = useMemo(() => {
    const streamMap = new Map<string, TelemetrySeries>();
    const rowMap = new Map<string, TelemetryWideRow>();
    points.forEach((point) => {
      const streamId = point.series.data_stream_id;
      streamMap.set(streamId, point.series);
      const row = rowMap.get(point.ts) ?? { ts: point.ts, values: {} };
      row.values[streamId] = point;
      rowMap.set(point.ts, row);
    });
    return { rows: [...rowMap.values()], streams: [...streamMap.values()] };
  }, [points]);
  const columns = useMemo(() => {
    const column = createColumnHelper<TelemetryWideRow>();
    return [
      column.accessor("ts", {
        header: "时间",
        cell: ({ getValue }) => (
          <span className="telemetry-time">{formatTime(getValue())}</span>
        ),
      }),
      ...streams.map((stream) =>
        column.accessor((row) => row.values[stream.data_stream_id]?.value, {
          id: stream.data_stream_id,
          header: () => (
            <span className="telemetry-metric-header">
              <strong>{stream.name}</strong>
              <small>
                {stream.code} · {stream.unit}
              </small>
            </span>
          ),
          cell: ({ row }) => {
            const point = row.original.values[stream.data_stream_id];
            if (!point) return <span className="muted">—</span>;
            return (
              <span
                className="telemetry-reading"
                title={`质量：${point.quality}`}
              >
                <span
                  className={`telemetry-quality ${healthyTelemetryQuality(point.quality) ? "healthy" : "warning"}`}
                />
                <span className="reading-value">{String(point.value)}</span>
                <small>{stream.unit}</small>
              </span>
            );
          },
        }),
      ),
    ];
  }, [formatTime, streams]);
  const table = useReactTable({
    data: rows,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    initialState: { pagination: { pageIndex: 0, pageSize: 25 } },
  });
  const pagination = table.getState().pagination;
  const start = rows.length
    ? pagination.pageIndex * pagination.pageSize + 1
    : 0;
  const end = Math.min(
    (pagination.pageIndex + 1) * pagination.pageSize,
    rows.length,
  );
  return (
    <div className="telemetry-table-shell">
      <div className="table-wrap telemetry-table-wrap">
        <table className="data-table telemetry-table">
          <thead>
            {table.getHeaderGroups().map((group) => (
              <tr key={group.id}>
                {group.headers.map((header) => {
                  const sorted = header.column.getIsSorted();
                  return (
                    <th key={header.id}>
                      <button
                        type="button"
                        className="table-sort"
                        onClick={header.column.getToggleSortingHandler()}
                      >
                        {flexRender(
                          header.column.columnDef.header,
                          header.getContext(),
                        )}
                        {sorted === "asc" ? (
                          <ArrowUp size={12} />
                        ) : sorted === "desc" ? (
                          <ArrowDown size={12} />
                        ) : (
                          <ArrowUpDown size={12} />
                        )}
                      </button>
                    </th>
                  );
                })}
              </tr>
            ))}
          </thead>
          <tbody>
            {table.getRowModel().rows.map((row) => (
              <tr key={row.original.ts}>
                {row.getVisibleCells().map((cell) => (
                  <td key={cell.id}>
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="telemetry-table-footer">
        <span>
          显示 {start}-{end}，共 {rows.length} 个时间点
        </span>
        <label>
          每页
          <select
            value={pagination.pageSize}
            onChange={(event) => table.setPageSize(Number(event.target.value))}
          >
            {[25, 50, 100, 200].map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </select>
        </label>
        <span>
          第 {pagination.pageIndex + 1} / {table.getPageCount()} 页
        </span>
        <div className="telemetry-page-actions">
          <IconButton
            label="上一页"
            disabled={!table.getCanPreviousPage()}
            onClick={() => table.previousPage()}
          >
            <ChevronLeft size={16} />
          </IconButton>
          <IconButton
            label="下一页"
            disabled={!table.getCanNextPage()}
            onClick={() => table.nextPage()}
          >
            <ChevronRight size={16} />
          </IconButton>
        </div>
      </div>
    </div>
  );
}
