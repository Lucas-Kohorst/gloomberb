/** @jsxImportSource react */
/**
 * Shared table view.
 *
 * Header click sorts, matching the panes these snapshots come from — a shared
 * table that cannot be re-sorted is a screenshot with extra steps.
 */

import { useMemo, useState } from "react";
import type { TableSharePayload } from "../../shares/payload";
import { ShareHeading, ShareShell, formatShareTimestamp } from "./shell";

/**
 * Cells are formatted strings, so ordering has to recover the number behind
 * `$1,234.5` or `-2.3%` before comparing. Anything that is not numeric falls
 * back to a locale compare.
 */
function numericValue(text: string): number | null {
  const cleaned = text.replace(/[$,%\s,]/g, "").replace(/[()]/g, "");
  if (!cleaned || !/\d/.test(cleaned)) return null;
  const parsed = Number(cleaned);
  if (!Number.isFinite(parsed)) return null;
  return /^\(.*\)$/.test(text.trim()) ? -parsed : parsed;
}

function compareCells(left: string, right: string): number {
  const leftNumber = numericValue(left);
  const rightNumber = numericValue(right);
  if (leftNumber !== null && rightNumber !== null) return leftNumber - rightNumber;
  if (leftNumber !== null) return -1;
  if (rightNumber !== null) return 1;
  return left.localeCompare(right);
}

export function TableShareView({
  payload,
  openInTerminalHref,
}: {
  payload: TableSharePayload;
  openInTerminalHref?: string | null;
}) {
  const [sort, setSort] = useState<{ columnIndex: number; direction: "asc" | "desc" } | null>(null);

  const rows = useMemo(() => {
    if (!sort) return payload.rows;
    const factor = sort.direction === "asc" ? 1 : -1;
    return [...payload.rows].sort((left, right) => factor * compareCells(
      left.cells[sort.columnIndex]?.text ?? "",
      right.cells[sort.columnIndex]?.text ?? "",
    ));
  }, [payload.rows, sort]);

  const toggleSort = (columnIndex: number) => {
    setSort((current) => (
      current?.columnIndex === columnIndex && current.direction === "asc"
        ? { columnIndex, direction: "desc" }
        : { columnIndex, direction: "asc" }
    ));
  };

  const captured = formatShareTimestamp(payload.capturedAt);
  const meta = [
    ...(captured ? [{ label: "Snapshot", value: captured }] : []),
    { label: "Rows", value: String(payload.rows.length) },
  ];

  return (
    <ShareShell
      layout="wide"
      openInTerminalHref={openInTerminalHref}
      openInTerminalLabel="Open live in terminal"
    >
      <ShareHeading title={payload.title} subtitle={payload.subtitle} meta={meta} />

      <div className="share-table-scroll">
        <table className="share-table">
          <thead>
            <tr>
              {payload.columns.map((column, columnIndex) => (
                <th
                  key={column.id}
                  data-align={column.align ?? "left"}
                  onClick={() => toggleSort(columnIndex)}
                  style={{ cursor: "pointer" }}
                  aria-sort={sort?.columnIndex === columnIndex
                    ? (sort.direction === "asc" ? "ascending" : "descending")
                    : "none"}
                >
                  {column.label}
                  {sort?.columnIndex === columnIndex ? (sort.direction === "asc" ? " ▲" : " ▼") : ""}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, rowIndex) => (
              <tr key={rowIndex}>
                {payload.columns.map((column, columnIndex) => {
                  const cell = row.cells[columnIndex];
                  const text = cell?.text ?? "";
                  return (
                    <td
                      key={column.id}
                      data-align={column.align ?? "left"}
                      style={cell?.color ? { color: cell.color } : undefined}
                    >
                      {columnIndex === 0 && row.url
                        ? <a href={row.url} target="_blank" rel="noreferrer noopener">{text}</a>
                        : text}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {payload.truncatedFrom ? (
        <p className="share-note">
          Showing the first {payload.rows.length} of {payload.truncatedFrom} rows.
          Open it in the terminal for the full table.
        </p>
      ) : (
        <p className="share-note">
          Snapshot of the sharer&rsquo;s view. Open it in the terminal for live data.
        </p>
      )}
    </ShareShell>
  );
}
