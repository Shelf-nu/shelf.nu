/**
 * @file Generic spreadsheet-style grid for import previews.
 *
 * Renders rows of cells tinted by tone (changed, clearing, warning, new) with a
 * hover and focus tooltip rendered through a portal, so the scroll container
 * never clips it. Both the content import preview and the bulk update preview
 * feed it `ImportGridRow` data.
 *
 * @see {@link file://./../bulk-update/spreadsheet-preview.tsx} Update-flow adapter
 * @see {@link file://./../../../modules/asset-import/types.ts} Row and cell types
 */
import type React from "react";
import { useCallback, useId, useState } from "react";
import { createPortal } from "react-dom";
import type {
  ImportGridCell,
  ImportGridRow,
} from "~/modules/asset-import/types";
import { AlertIcon } from "../../icons/library";

/** Tailwind classes per tone: cell background, cell text, and legend swatch. */
const TONE_CLASSES: Record<
  ImportGridCell["tone"],
  { bg: string; text: string; tooltipText: string; swatch: string }
> = {
  plain: {
    bg: "",
    text: "text-gray-900",
    tooltipText: "text-gray-700",
    swatch: "",
  },
  changed: {
    bg: "bg-blue-50",
    text: "text-blue-700",
    tooltipText: "text-blue-700",
    swatch: "bg-blue-50 ring-1 ring-blue-200",
  },
  clearing: {
    bg: "bg-amber-50",
    text: "text-amber-700",
    tooltipText: "text-blue-700",
    swatch: "bg-amber-50 ring-1 ring-amber-200",
  },
  warning: {
    bg: "bg-red-50",
    text: "text-red-700",
    tooltipText: "text-red-700",
    swatch: "bg-red-50 ring-1 ring-red-200",
  },
  new: {
    bg: "bg-green-50",
    text: "text-green-700",
    tooltipText: "text-green-700",
    swatch: "bg-green-50 ring-1 ring-green-200",
  },
};

/** Props for {@link ImportGrid}. */
type ImportGridProps = {
  /** Column headings, in display order. Each is also the key into `row.cells`. */
  columns: string[];
  /** The rows to render. May be a truncated slice of the file. */
  rows: ImportGridRow[];
  /** Rows in the whole file. A footer notes the truncation when above `rows.length`. */
  totalRows: number;
  /** Summary line shown above the table. */
  caption: React.ReactNode;
  /** Legend entries. A `plain` entry renders the "no value" dash glyph. */
  legend: { tone: ImportGridCell["tone"]; label: string }[];
  /** Heading of the leftmost column. Defaults to "Row". */
  labelHeading?: string;
  /** Accessible name of the table. Defaults to "Import preview". */
  ariaLabel?: string;
};

/** Identifies the cell whose tooltip is open. */
type HoveredCell = { rowKey: string; col: string };

/**
 * Renders the import preview grid with tone-colored cells, a viewport-aware
 * tooltip, a truncation footer, and a legend.
 *
 * @param props - See {@link ImportGridProps}
 * @returns The grid, its caption and legend
 */
export function ImportGrid({
  columns,
  rows,
  totalRows,
  caption,
  legend,
  labelHeading = "Row",
  ariaLabel = "Import preview",
}: ImportGridProps) {
  const idPrefix = useId();
  const [hoveredCell, setHoveredCell] = useState<HoveredCell | null>(null);
  const [tooltipStyle, setTooltipStyle] = useState<React.CSSProperties>({});

  /** Measure the cell and compute fixed tooltip coordinates, flipping below near the top. */
  const handleCellHover = useCallback(
    (rowKey: string, col: string, el: HTMLTableCellElement) => {
      const rect = el.getBoundingClientRect();
      const above = rect.top > 80;
      setTooltipStyle({
        position: "fixed",
        left: rect.left + rect.width / 2,
        ...(above
          ? { bottom: window.innerHeight - rect.top + 4 }
          : { top: rect.bottom + 4 }),
        transform: "translateX(-50%)",
        zIndex: 50,
      });
      setHoveredCell({ rowKey, col });
    },
    []
  );

  return (
    <div className="mb-4">
      <p className="mb-2 text-sm font-medium text-gray-700">{caption}</p>
      <div className="max-h-[600px] overflow-auto rounded-md border">
        <table
          className="w-full border-collapse text-sm"
          aria-label={ariaLabel}
        >
          <thead className="sticky top-0 z-10">
            <tr className="bg-gray-100">
              <th className="sticky left-0 z-20 border-b border-r bg-gray-100 px-3 py-2 text-left font-semibold text-gray-700">
                {labelHeading}
              </th>
              {columns.map((col) => (
                <th
                  key={col}
                  className="border-b border-r px-3 py-2 text-left font-semibold text-gray-700"
                >
                  {col}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, rowIdx) => (
              <tr
                key={row.key}
                className="border-b transition-colors last:border-b-0 hover:bg-gray-50/50"
              >
                {/* Sticky label column */}
                <td className="sticky left-0 z-[5] border-r bg-white px-3 py-1.5 font-medium text-gray-900">
                  <div className="max-w-[180px] truncate" title={row.label}>
                    {row.label}
                  </div>
                  {row.sublabel ? (
                    <div className="text-[10px] font-normal text-gray-400">
                      {row.sublabel}
                    </div>
                  ) : null}
                </td>

                {columns.map((col, colIdx) => {
                  const cell = row.cells[col];

                  if (!cell) {
                    return (
                      <td
                        key={col}
                        className="border-r px-3 py-1.5 text-center text-gray-300"
                      >
                        -
                      </td>
                    );
                  }

                  const tone = TONE_CLASSES[cell.tone];
                  const isHovered =
                    hoveredCell?.rowKey === row.key && hoveredCell?.col === col;
                  const tooltipId = `${idPrefix}-tooltip-${rowIdx}-${colIdx}`;
                  // Plain cells without a note have nothing to reveal.
                  const hasTooltip = cell.tone !== "plain" || !!cell.note;
                  const showsWarning = cell.tone === "warning" && !!cell.note;

                  return (
                    <td
                      key={col}
                      tabIndex={hasTooltip ? 0 : undefined}
                      aria-describedby={isHovered ? tooltipId : undefined}
                      className={`cursor-default border-r px-3 py-1.5 ${tone.bg}`}
                      onMouseEnter={
                        hasTooltip
                          ? (e) =>
                              handleCellHover(row.key, col, e.currentTarget)
                          : undefined
                      }
                      onMouseLeave={
                        hasTooltip ? () => setHoveredCell(null) : undefined
                      }
                      onFocus={
                        hasTooltip
                          ? (e) =>
                              handleCellHover(row.key, col, e.currentTarget)
                          : undefined
                      }
                      onBlur={
                        hasTooltip ? () => setHoveredCell(null) : undefined
                      }
                    >
                      <div
                        className={`max-w-[180px] truncate font-medium ${tone.text}`}
                      >
                        {cell.value}
                      </div>
                      {cell.previous !== undefined ? (
                        <div className="max-w-[180px] truncate text-[11px] text-gray-400 line-through">
                          {cell.previous}
                        </div>
                      ) : null}
                      {showsWarning ? (
                        <div className="truncate text-[10px] text-red-500">
                          <AlertIcon className="inline-block size-4" />{" "}
                          {cell.note}
                        </div>
                      ) : null}

                      {/* Tooltip rendered via portal to avoid scroll clipping */}
                      {isHovered &&
                        createPortal(
                          <div
                            id={tooltipId}
                            role="tooltip"
                            style={tooltipStyle}
                            className="w-max max-w-[280px] rounded-md border bg-white px-3 py-2 text-xs shadow-lg"
                          >
                            <p className="mb-1 font-semibold text-gray-700">
                              {col}
                            </p>
                            {cell.previous !== undefined ? (
                              <p className="text-gray-500">
                                <span className="font-medium text-gray-400">
                                  Was:
                                </span>{" "}
                                {cell.previous || "(empty)"}
                              </p>
                            ) : null}
                            <p className={tone.tooltipText}>
                              {cell.previous !== undefined ? (
                                <>
                                  <span
                                    className={`font-medium ${
                                      cell.tone === "warning"
                                        ? "text-red-600"
                                        : "text-blue-600"
                                    }`}
                                  >
                                    Now:
                                  </span>{" "}
                                </>
                              ) : null}
                              {cell.value}
                            </p>
                            {cell.note ? (
                              <p
                                className={`mt-1 ${
                                  cell.tone === "warning"
                                    ? "text-red-600"
                                    : tone.tooltipText
                                }`}
                              >
                                {cell.tone === "warning" ? (
                                  <>
                                    <AlertIcon className="inline-block size-4" />{" "}
                                  </>
                                ) : null}
                                {cell.note}
                              </p>
                            ) : null}
                          </div>,
                          document.body
                        )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {rows.length < totalRows ? (
        <p className="mt-2 text-xs text-gray-500">
          Showing the first {rows.length} of {totalRows} rows
        </p>
      ) : null}

      {/* Legend */}
      <div className="mt-2 flex flex-wrap items-center gap-4 text-xs text-gray-500">
        {legend.map((item) => (
          <span key={item.label} className="flex items-center gap-1.5">
            {item.tone === "plain" ? (
              <span className="text-gray-300">-</span>
            ) : (
              <span
                className={`inline-block size-3 rounded-sm ${
                  TONE_CLASSES[item.tone].swatch
                }`}
              />
            )}
            {item.label}
          </span>
        ))}
      </div>
    </div>
  );
}
