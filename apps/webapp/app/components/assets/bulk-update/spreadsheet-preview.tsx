/**
 * @file Adapter that renders bulk asset update changes in the generic import grid.
 * Maps each `AssetChangePreview` to an `ImportGridRow` (old value struck
 * through, tone derived from the warning and clearing flags) and supplies the
 * update flow's caption and legend.
 *
 * @see {@link file://./preview-display.tsx} Parent component
 * @see {@link file://./../import-preview/import-grid.tsx} Generic grid
 */
import type {
  ImportGridCell,
  ImportGridRow,
} from "~/modules/asset-import/types";
import type { AssetChangePreview } from "~/utils/import-update.server";
import { ImportGrid } from "../import-preview/import-grid";

/** Legend of the update flow: changed, warning, and unchanged cells. */
const UPDATE_LEGEND: { tone: ImportGridCell["tone"]; label: string }[] = [
  { tone: "changed", label: "Changed: will be updated" },
  { tone: "warning", label: "Warning: value may be invalid" },
  { tone: "plain", label: "No change" },
];

/**
 * Converts one asset's field changes into a grid row.
 *
 * @param asset - The asset and its proposed changes
 * @returns A row keyed by asset ID with one cell per changed field
 */
function toGridRow(asset: AssetChangePreview): ImportGridRow {
  const cells: Record<string, ImportGridCell> = {};
  for (const change of asset.changes) {
    // Warning wins over clearing: a flagged change is never written.
    const tone: ImportGridCell["tone"] = change.warning
      ? "warning"
      : change.clearing
      ? "clearing"
      : "changed";
    cells[change.field] = {
      value: change.clearing ? "(clear)" : change.newValue,
      previous: change.currentValue,
      tone,
      note: change.warning || undefined,
    };
  }
  return { key: asset.id, label: asset.title, sublabel: asset.id, cells };
}

/**
 * Renders a spreadsheet-like grid of asset field changes.
 * Highlights changed cells in blue, clearing cells in amber and cells with
 * warnings in red, with hover tooltips showing the full old and new values.
 *
 * @param props.assets - Assets with proposed changes
 * @param props.columns - Updatable column headings, in display order
 * @param props.displayLimit - Maximum number of rows to render
 * @param props.totalChanges - Changes the apply layer will write (warnings excluded)
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
  const totalAssets = assets.length;
  const rows = assets.slice(0, displayLimit).map(toGridRow);

  const caption = (
    <>
      {/* `totalChanges` counts only changes the apply layer will write.
          Rows whose every change is warning-marked still render below (the
          user needs to see what was flagged), so the count can legitimately
          be 0 while rows are shown. Say that plainly rather than printing
          a contradictory "0 changes across 2 assets". */}
      {totalChanges === 0 ? (
        <>
          No changes to apply: {totalAssets} asset
          {totalAssets !== 1 ? "s" : ""} need
          {totalAssets === 1 ? "s" : ""} fixing
        </>
      ) : (
        <>
          {totalChanges} change{totalChanges !== 1 ? "s" : ""} across{" "}
          {totalAssets} asset{totalAssets !== 1 ? "s" : ""}
        </>
      )}
      {totalAssets > displayLimit && ` (showing first ${displayLimit})`}
    </>
  );

  return (
    <ImportGrid
      columns={columns}
      rows={rows}
      // why: the caption already states the truncation, so the grid's own
      // "Showing the first N" footer is suppressed by passing the rendered
      // count as the total.
      totalRows={rows.length}
      caption={caption}
      legend={UPDATE_LEGEND}
      labelHeading="Asset"
      ariaLabel="Asset changes preview"
    />
  );
}
