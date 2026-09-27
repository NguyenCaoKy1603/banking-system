import type { ReactNode } from "react";

interface Column<T> {
  header: string;
  className?: string;
  render: (item: T, index: number) => ReactNode;
}

interface DataTableProps<T> {
  columns?: Column<T>[];
  items?: T[];
  emptyMessage?: string;
  children?: ReactNode;
}

export function DataTable<T>({
  columns,
  items,
  emptyMessage = "Không có dữ liệu.",
  children,
}: DataTableProps<T>) {
  if (children) {
    return (
      <div className="table-wrap">
        <table>
          <tbody>{children}</tbody>
        </table>
      </div>
    );
  }

  if (!items || items.length === 0) {
    return <div className="empty-state">{emptyMessage}</div>;
  }

  return (
    <div className="table-wrap">
      <table>
        {columns ? (
          <thead>
            <tr>
              {columns.map((col, idx) => (
                <th key={idx} className={col.className}>
                  {col.header}
                </th>
              ))}
            </tr>
          </thead>
        ) : null}
        <tbody>
          {items.map((item, rowIdx) => (
            <tr key={rowIdx}>
              {columns?.map((col, colIdx) => (
                <td key={colIdx} className={col.className}>
                  {col.render(item, rowIdx)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function TableRow({ label, value }: { label: ReactNode; value: ReactNode }) {
  return (
    <tr>
      <th>{label}</th>
      <td>{value}</td>
    </tr>
  );
}
