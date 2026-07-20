/**
 * Export button for the assets index.
 *
 * Offers two formats — "Standard" (human/analytics CSV mirroring the on-screen
 * columns) and "Import-ready" (headers/values shaped for re-import into another
 * workspace) — and a column scope (Visible vs All), via a Radix Popover.
 *
 * @see {@link file://./../../../utils/import-ready-export.server.ts} import-ready builder
 * @see {@link file://./../../../routes/_layout+/assets.export.$fileName[.csv].tsx} export route
 */
import { useId, useState } from "react";
import {
  Popover,
  PopoverContent,
  PopoverPortal,
  PopoverTrigger,
} from "@radix-ui/react-popover";
import { useAtomValue } from "jotai";
import { useLoaderData } from "react-router";
import { selectedBulkItemsAtom } from "~/atoms/list";
import { UpgradeMessage } from "~/components/marketing/upgrade-message";
import { Button } from "~/components/shared/button";
import { Spinner } from "~/components/shared/spinner";
import { useSearchParams } from "~/hooks/search-params";
import type { AssetIndexLoaderData } from "~/routes/_layout+/assets._index";
import { isSelectingAllItems } from "~/utils/list";

type ExportFormat = "standard" | "import";
type ExportColumnScope = "visible" | "all";

/**
 * Builds the export request query string. Pure so it can be unit-tested.
 *
 * @param args.assetIds - Explicitly selected asset ids (empty when "select all" is active).
 * @param args.allSelected - Whether the "select all" pseudo-selection is active.
 * @param args.currentSearchParams - The assets-index URL search params to forward
 *   when `allSelected` is true, so the export applies the same filters.
 * @param args.format - Export format: "standard" (on-screen columns) or "import"
 *   (import-ready CSV).
 * @param args.columnScope - Whether to export only visible columns or all columns.
 * @returns A URL-encoded query string (no leading "?").
 */
export function buildExportSearchParams({
  assetIds,
  allSelected,
  currentSearchParams,
  format,
  columnScope,
}: {
  assetIds: string[];
  allSelected: boolean;
  currentSearchParams: string;
  format: ExportFormat;
  columnScope: ExportColumnScope;
}): string {
  const params = new URLSearchParams();
  if (assetIds.length > 0) {
    params.set("assetIds", assetIds.join(","));
  }
  if (allSelected) {
    params.set("assetIndexCurrentSearchParams", currentSearchParams);
  }
  params.set("exportType", format);
  params.set("columnScope", columnScope);
  return params.toString();
}

/** A labelled radio row used inside the export Popover. */
function RadioRow({
  name,
  checked,
  onChange,
  label,
  hint,
}: {
  name: string;
  checked: boolean;
  onChange: () => void;
  label: string;
  hint?: string;
}) {
  // Stable id so the hint can be linked to the input via aria-describedby,
  // exposing it to assistive tech as descriptive text rather than the label.
  const hintId = useId();
  return (
    <label className="mb-1 flex cursor-pointer items-start gap-2">
      <input
        type="radio"
        name={name}
        checked={checked}
        onChange={onChange}
        className="mt-1"
        aria-describedby={hint ? hintId : undefined}
      />
      <span className="flex flex-col">
        <span className="text-sm text-gray-900">{label}</span>
        {hint ? (
          <span id={hintId} className="text-xs text-gray-500">
            {hint}
          </span>
        ) : null}
      </span>
    </label>
  );
}

/**
 * Assets-index export control (split button → Popover).
 *
 * Lets the user pick a format (Standard vs Import-ready) and a column scope
 * (Visible vs All) before downloading a CSV of the currently selected assets.
 * Falls back to a disabled upgrade-prompt button on the free tier.
 */
export function ExportAssetsButton() {
  const selectedAssets = useAtomValue(selectedBulkItemsAtom);
  const { canImportAssets } = useLoaderData<AssetIndexLoaderData>();
  const [searchParams] = useSearchParams();
  const [isDownloading, setIsDownloading] = useState(false);
  const [open, setOpen] = useState(false);
  const [format, setFormat] = useState<ExportFormat>("standard");
  const [columnScope, setColumnScope] = useState<ExportColumnScope>("visible");
  const [exportError, setExportError] = useState<string | null>(null);

  const disabled = selectedAssets.length === 0;
  const allSelected = isSelectingAllItems(selectedAssets);
  const title = `Export selection ${
    disabled ? "" : allSelected ? "(All)" : `(${selectedAssets.length})`
  }`;

  /** Flip the scope default when the format changes (import → all columns). */
  const handleFormatChange = (next: ExportFormat) => {
    setFormat(next);
    setColumnScope(next === "import" ? "all" : "visible");
  };

  const handleExport = async () => {
    setIsDownloading(true);
    setExportError(null);
    try {
      const assetIds = selectedAssets.map((asset) => asset.id);
      const fileName = `assets${
        format === "import" ? "-import-ready" : ""
      }-${new Date().toISOString().slice(0, 10)}-${new Date().getTime()}.csv`;
      const qs = buildExportSearchParams({
        assetIds,
        allSelected,
        currentSearchParams: searchParams.toString(),
        format,
        columnScope,
      });

      const response = await fetch(`/assets/export/${fileName}?${qs}`);
      // Don't save an error/auth payload under a .csv filename — surface it.
      if (!response.ok) {
        setExportError("Export failed. Please try again.");
        return;
      }
      const blob = await response.blob();
      const downloadUrl = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = downloadUrl;
      link.setAttribute("download", fileName);
      document.body.appendChild(link);
      link.click();
      link.remove();
      // Release the object URL so the blob can be garbage-collected.
      window.URL.revokeObjectURL(downloadUrl);
      setOpen(false);
    } catch {
      setExportError("Export failed. Please try again.");
    } finally {
      setIsDownloading(false);
    }
  };

  // Free tier: keep the disabled upgrade-prompt button (no Popover).
  if (!canImportAssets) {
    return (
      <Button
        type="button"
        variant="secondary"
        className="whitespace-nowrap font-medium"
        disabled={{
          reason: (
            <>
              Exporting is not available on the free tier of shelf.{" "}
              <UpgradeMessage />
            </>
          ),
        }}
      >
        {title}
      </Button>
    );
  }

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setExportError(null);
      }}
    >
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="secondary"
          className="whitespace-nowrap font-medium"
          title={title}
          disabled={
            disabled
              ? { reason: "You must select at least 1 asset to export" }
              : isDownloading
          }
        >
          <div className="flex items-center gap-1">
            {isDownloading ? (
              <span>
                <Spinner />
              </span>
            ) : null}
            <span>{title}</span>
          </div>
        </Button>
      </PopoverTrigger>
      <PopoverPortal>
        <PopoverContent
          align="end"
          sideOffset={5}
          className="z-[100] w-[320px] rounded-md border border-gray-200 bg-white p-4 shadow-lg"
        >
          <fieldset className="mb-4">
            <legend className="mb-2 text-sm font-semibold text-gray-900">
              Format
            </legend>
            <RadioRow
              name="export-format"
              checked={format === "standard"}
              onChange={() => handleFormatChange("standard")}
              label="Standard"
              hint="Readable spreadsheet, matches your columns"
            />
            <RadioRow
              name="export-format"
              checked={format === "import"}
              onChange={() => handleFormatChange("import")}
              label="Import-ready"
              hint="Re-import into another workspace"
            />
          </fieldset>

          <fieldset className="mb-4">
            <legend className="mb-2 text-sm font-semibold text-gray-900">
              Columns
            </legend>
            <RadioRow
              name="export-scope"
              checked={columnScope === "visible"}
              onChange={() => setColumnScope("visible")}
              label="Visible columns"
            />
            <RadioRow
              name="export-scope"
              checked={columnScope === "all"}
              onChange={() => setColumnScope("all")}
              label="All columns"
            />
          </fieldset>

          {format === "import" ? (
            <p className="mb-4 text-xs text-gray-500">
              Import-ready always includes the fields required to recreate
              assets.
            </p>
          ) : null}

          {exportError ? (
            <p className="mb-4 text-xs text-error-500" role="alert">
              {exportError}
            </p>
          ) : null}

          <Button
            type="button"
            className="w-full"
            onClick={handleExport}
            disabled={isDownloading}
          >
            {isDownloading ? "Preparing…" : "Download CSV"}
          </Button>
        </PopoverContent>
      </PopoverPortal>
    </Popover>
  );
}
