/**
 * @file Spreadsheet-style preview grid for bulk asset update changes.
 * Renders a table showing old vs. new values with color-coded cells,
 * hover tooltips, and viewport-aware tooltip placement.
 *
 * @see {@link file://./preview-display.tsx} Parent component
 */
import { useCallback, useRef, useState } from "react";
import type { AssetChangePreview } from "~/utils/import-update.server";

// ---------------------------------------------------------------------------
// Spreadsheet-style Preview Grid
// ---------------------------------------------------------------------------

/**
 * Renders a spreadsheet-like grid of asset field changes.
 * Highlights changed cells in blue, cells with warnings in red,
 * and shows hover tooltips with full old/new values.
 */
export function SpreadsheetPreview({
  assets,
  columns,
  displayLimit,
  totalChanges,
}: {
  assets: AssetChangePreview[];
  columns: string[];
  displayLimit: number;
  totalChanges: number;
}) {
  const [hoveredCell, setHoveredCell] = useState<{
    assetIdx: number;
    col: string;
  } | null>(null);
  const [tooltipAbove, setTooltipAbove] = useState(true);
  const cellRef = useRef<HTMLTableCellElement | null>(null);

  /** Measure available space above the cell to decide tooltip placement */
  const handleCellHover = useCallback(
    (assetIdx: number, col: string, el: HTMLTableCellElement) => {
      cellRef.current = el;
      const rect = el.getBoundingClientRect();
      // Flip below if less than 80px above the cell
      setTooltipAbove(rect.top > 80);
      setHoveredCell({ assetIdx, col });
    },
    []
  );

  const totalAssets = assets.length;
  const displayAssets = assets.slice(0, displayLimit);

  return (
    <div className="mb-4">
      <p className="mb-2 text-sm font-medium text-gray-700">
        {totalChanges} change{totalChanges !== 1 ? "s" : ""} across{" "}
        {totalAssets} asset{totalAssets !== 1 ? "s" : ""}
        {totalAssets > displayLimit && ` (showing first ${displayLimit})`}
      </p>
      <div className="max-h-[420px] overflow-auto rounded-md border">
        <table className="w-full border-collapse text-sm">
          <thead className="sticky top-0 z-10">
            <tr className="bg-gray-100">
              <th className="sticky left-0 z-20 border-b border-r bg-gray-100 px-3 py-2 text-left font-semibold text-gray-700">
                Asset
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
            {displayAssets.map((asset, assetIdx) => {
              // Build a map for O(1) change lookups
              const changesByField = new Map(
                asset.changes.map((c) => [c.field, c])
              );

              return (
                <tr
                  key={asset.id}
                  className="border-b transition-colors last:border-b-0 hover:bg-gray-50/50"
                >
                  {/* Sticky asset name column */}
                  <td className="sticky left-0 z-[5] border-r bg-white px-3 py-1.5 font-medium text-gray-900">
                    <div className="max-w-[180px] truncate" title={asset.title}>
                      {asset.title}
                    </div>
                    <div className="text-[10px] font-normal text-gray-400">
                      {asset.id}
                    </div>
                  </td>

                  {/* One cell per updatable column */}
                  {columns.map((col) => {
                    const change = changesByField.get(col);
                    const isHovered =
                      hoveredCell?.assetIdx === assetIdx &&
                      hoveredCell?.col === col;

                    if (!change) {
                      // No change for this field — show dash
                      return (
                        <td
                          key={col}
                          className="border-r px-3 py-1.5 text-center text-gray-300"
                        >
                          —
                        </td>
                      );
                    }

                    // Changed cell — highlighted (red if warning, blue if valid)
                    const hasWarning = !!change.warning;
                    return (
                      <td
                        key={col}
                        tabIndex={0}
                        className={`relative cursor-default border-r px-3 py-1.5 ${
                          hasWarning ? "bg-red-50" : "bg-blue-50"
                        }`}
                        onMouseEnter={(e) =>
                          handleCellHover(assetIdx, col, e.currentTarget)
                        }
                        onMouseLeave={() => setHoveredCell(null)}
                        onFocus={(e) =>
                          handleCellHover(assetIdx, col, e.currentTarget)
                        }
                        onBlur={() => setHoveredCell(null)}
                      >
                        <div
                          className={`max-w-[180px] truncate font-medium ${
                            hasWarning ? "text-red-700" : "text-blue-700"
                          }`}
                        >
                          {change.newValue}
                        </div>
                        <div className="max-w-[180px] truncate text-[11px] text-gray-400 line-through">
                          {change.currentValue}
                        </div>
                        {hasWarning && (
                          <div className="truncate text-[10px] text-red-500">
                            ⚠ {change.warning}
                          </div>
                        )}

                        {/* Tooltip on hover with full values */}
                        {isHovered && (
                          <div
                            className={`absolute left-1/2 z-30 w-max max-w-[280px] -translate-x-1/2 rounded-md border bg-white px-3 py-2 text-xs shadow-lg ${
                              tooltipAbove
                                ? "bottom-full mb-2"
                                : "top-full mt-2"
                            }`}
                          >
                            <p className="mb-1 font-semibold text-gray-700">
                              {col}
                            </p>
                            <p className="text-gray-500">
                              <span className="font-medium text-gray-400">
                                Was:
                              </span>{" "}
                              {change.currentValue || "(empty)"}
                            </p>
                            <p
                              className={
                                hasWarning ? "text-red-700" : "text-blue-700"
                              }
                            >
                              <span
                                className={`font-medium ${
                                  hasWarning ? "text-red-600" : "text-blue-600"
                                }`}
                              >
                                Now:
                              </span>{" "}
                              {change.newValue}
                            </p>
                            {hasWarning && (
                              <p className="mt-1 text-red-600">
                                ⚠ {change.warning}
                              </p>
                            )}
                          </div>
                        )}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Legend */}
      <div className="mt-2 flex items-center gap-4 text-xs text-gray-500">
        <span className="flex items-center gap-1.5">
          <span className="inline-block size-3 rounded-sm bg-blue-50 ring-1 ring-blue-200" />
          Changed — will be updated
        </span>
        <span className="flex items-center gap-1.5">
          <span className="text-gray-300">—</span>
          No change
        </span>
      </div>
    </div>
  );
}
