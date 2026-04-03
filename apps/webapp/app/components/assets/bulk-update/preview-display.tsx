/**
 * @file Preview stage for the bulk asset update import flow.
 * Displays the server-generated diff analysis before changes are applied,
 * including summary stats, validation warnings, new entity creation notices,
 * a spreadsheet-style change grid, and the "I AGREE" confirmation dialog.
 *
 * @see {@link file://./form.tsx} Parent orchestration component
 * @see {@link file://./../../../utils/import-update.server.ts} Server-side preview logic
 */
import type React from "react";
import type useFetcherWithReset from "~/hooks/use-fetcher-with-reset";
import type { action } from "~/routes/_layout+/assets.import-update";
import type { UpdatePreview } from "~/utils/import-update.server";
import { PREVIEW_DISPLAY_LIMIT } from "./helpers";
import { SummaryPill } from "./shared";
import { SpreadsheetPreview } from "./spreadsheet-preview";
import Input from "../../forms/input";
import { AlertIcon } from "../../icons/library";
import { Button } from "../../shared/button";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "../../shared/modal";
import { Table, Td, Th, Tr } from "../../table";

// ---------------------------------------------------------------------------
// Preview Display (shown after CSV analysis, before apply)
// ---------------------------------------------------------------------------

/**
 * Displays the server-generated bulk-update preview and handles the apply confirmation.
 * Shows summary statistics, validation warnings, unrecognized columns, new entity warnings,
 * failed rows, a spreadsheet-style change grid, and the "I AGREE" confirmation dialog.
 */
export function PreviewDisplay({
  preview,
  formRef,
  agreed,
  setAgreed,
  applyFetcher,
  isApplyLoading,
  selectedFile,
  onReanalyze,
  isReanalyzing,
  onReset,
}: {
  preview: UpdatePreview;
  formRef: React.RefObject<HTMLFormElement | null>;
  agreed: string;
  setAgreed: (v: string) => void;
  applyFetcher: ReturnType<typeof useFetcherWithReset<typeof action>>;
  isApplyLoading: boolean;
  selectedFile: File | null;
  onReanalyze: () => void;
  isReanalyzing: boolean;
  onReset: () => void;
}) {
  const totalChanges = preview.totalFieldChanges;
  const totalAssets = preview.assetsToUpdate.length;
  const hasNewEntities =
    preview.newEntities.categories.length > 0 ||
    preview.newEntities.locations.length > 0 ||
    preview.newEntities.tags.length > 0;

  // Collect all field-level validation warnings
  const allWarnings = preview.assetsToUpdate.flatMap((asset) =>
    asset.changes
      .filter((c) => c.warning)
      .map((c) => ({
        assetTitle: asset.title,
        assetId: asset.id,
        field: c.field,
        value: c.newValue,
        warning: c.warning!,
      }))
  );
  const hasWarnings = allWarnings.length > 0;

  function submitApply() {
    if (!formRef.current || !selectedFile) return;
    const fd = new FormData(formRef.current);
    fd.set("intent", "apply-update");
    fd.set("confirmation", agreed);
    void applyFetcher.submit(fd, {
      method: "post",
      encType: "multipart/form-data",
    });
  }

  return (
    <div className="mt-4 w-full">
      {/* Summary section — always first */}
      <div className="mb-4 rounded-md border bg-gray-50 p-4">
        <h4 className="mb-3 text-base font-semibold">Analysis Summary</h4>
        <div className="flex flex-wrap gap-3">
          <SummaryPill
            count={preview.assetsToUpdate.length}
            label="to update"
            color="blue"
          />
          <SummaryPill
            count={preview.skippedAssets.length}
            label="unchanged"
            color="gray"
          />
          <SummaryPill
            count={preview.failedRows.length}
            label="failed"
            color="red"
          />
        </div>

        {/* Reassurance message */}
        {preview.totalUnchangedFields > 0 && (
          <p className="mt-3 text-sm text-gray-500">
            {preview.totalUnchangedFields} field
            {preview.totalUnchangedFields !== 1 ? "s" : ""} across{" "}
            {preview.assetsToUpdate.length + preview.skippedAssets.length} asset
            {preview.assetsToUpdate.length + preview.skippedAssets.length !== 1
              ? "s"
              : ""}{" "}
            will remain unchanged.
          </p>
        )}
      </div>

      {/* Validation warnings — format issues that will cause failures */}
      {hasWarnings && (
        <div className="mb-4 rounded-md border border-red-200 bg-red-50 p-4">
          <p className="mb-2 font-medium text-red-800">
            {allWarnings.length} value
            {allWarnings.length !== 1 ? "s" : ""} need
            {allWarnings.length === 1 ? "s" : ""} fixing before you apply
          </p>
          <div className="max-h-[200px] overflow-y-auto">
            <Table className="[&_td]:px-2 [&_td]:py-1.5 [&_th]:px-2 [&_th]:py-1.5">
              <thead className="sticky top-0 bg-red-50">
                <Tr>
                  <Th>Asset</Th>
                  <Th>Field</Th>
                  <Th>Problem</Th>
                </Tr>
              </thead>
              <tbody>
                {allWarnings.map((w, i) => (
                  <Tr key={i}>
                    <Td className="font-medium">{w.assetTitle}</Td>
                    <Td>{w.field}</Td>
                    <Td className="text-red-600">{w.warning}</Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          </div>
          <p className="mt-2 text-sm text-red-700">
            Fix these values in your CSV and re-upload, or apply anyway — rows
            with invalid values will be partially updated (valid fields will
            still be saved, invalid ones will be skipped).
          </p>
        </div>
      )}

      {/* Unrecognized columns — the user added columns that don't exist */}
      {preview.unrecognizedColumns.length > 0 && (
        <div className="mb-4 rounded-md border border-blue-200 bg-blue-50 p-4">
          <p className="mb-1 font-medium text-blue-800">
            We skipped{" "}
            {preview.unrecognizedColumns.length === 1
              ? "a column"
              : `${preview.unrecognizedColumns.length} columns`}{" "}
            we don't recognize
          </p>
          <div className="mb-2 flex flex-wrap gap-1.5">
            {preview.unrecognizedColumns.map((col) => (
              <span
                key={col}
                className="rounded-full bg-blue-100 px-2.5 py-0.5 text-xs font-medium text-blue-700"
              >
                {col}
              </span>
            ))}
          </div>
          <p className="text-sm text-blue-700">
            To import data for these columns, first create them as{" "}
            <Button variant="link" to="/settings/custom-fields" target="_blank">
              Custom Fields
            </Button>{" "}
            in your workspace, then come back and re-analyze.
          </p>
          <Button
            type="button"
            variant="secondary"
            className="mt-2"
            onClick={onReanalyze}
            disabled={isReanalyzing}
          >
            {isReanalyzing ? "Re-analyzing..." : "Re-analyze file"}
          </Button>
        </div>
      )}

      {/* Known but unsupported columns */}
      {preview.ignoredColumns.length > 0 && (
        <details className="mb-4">
          <summary className="cursor-pointer text-sm text-gray-500">
            Your file has {preview.ignoredColumns.length} column
            {preview.ignoredColumns.length !== 1 ? "s" : ""} that can't be
            bulk-updated (click to see which)
          </summary>
          <p className="mt-1 text-xs text-gray-500">
            {preview.ignoredColumns.join(", ")} — these columns are present in
            your file but are read-only in this tool. Any edits you made to them
            won't be applied.
          </p>
        </details>
      )}

      {/* New entity creation warning */}
      {hasNewEntities && (
        <div className="mb-4 rounded-md border border-amber-200 bg-amber-50 p-4">
          <p className="mb-2 font-medium text-amber-800">
            <AlertIcon className="inline-block size-4" /> New items will be
            created
          </p>
          <p className="mb-2 text-sm text-amber-700">
            The following items don't exist yet and will be created
            automatically. Please check for typos:
          </p>
          <div className="space-y-1 text-sm text-amber-800">
            {preview.newEntities.categories.length > 0 && (
              <p>
                <strong>New categories:</strong>{" "}
                {preview.newEntities.categories.map((name, i) => (
                  <span key={i}>
                    {i > 0 && ", "}
                    <span className="rounded bg-amber-100 px-1.5 py-0.5 font-mono text-xs">
                      {name}
                    </span>
                  </span>
                ))}
              </p>
            )}
            {preview.newEntities.locations.length > 0 && (
              <p>
                <strong>New locations:</strong>{" "}
                {preview.newEntities.locations.map((name, i) => (
                  <span key={i}>
                    {i > 0 && ", "}
                    <span className="rounded bg-amber-100 px-1.5 py-0.5 font-mono text-xs">
                      {name}
                    </span>
                  </span>
                ))}
              </p>
            )}
            {preview.newEntities.tags.length > 0 && (
              <p>
                <strong>New tags:</strong>{" "}
                {preview.newEntities.tags.map((name, i) => (
                  <span key={i}>
                    {i > 0 && ", "}
                    <span className="rounded bg-amber-100 px-1.5 py-0.5 font-mono text-xs">
                      {name}
                    </span>
                  </span>
                ))}
              </p>
            )}
          </div>
        </div>
      )}

      {/* Failed rows */}
      {preview.failedRows.length > 0 && (
        <div className="mb-4">
          <h4 className="mb-2 text-red-600">
            Failed rows ({preview.failedRows.length})
          </h4>
          <div className="max-h-[200px] overflow-y-auto rounded-md border border-red-200">
            <Table className="[&_td]:px-2 [&_td]:py-1.5 [&_th]:px-2 [&_th]:py-1.5">
              <thead className="sticky top-0 bg-red-50">
                <Tr>
                  <Th>Row</Th>
                  <Th>ID</Th>
                  <Th>Reason</Th>
                </Tr>
              </thead>
              <tbody>
                {preview.failedRows.map((row, i) => (
                  <Tr key={i}>
                    <Td>{row.rowNumber}</Td>
                    <Td className="font-mono text-xs">{row.id || "(empty)"}</Td>
                    <Td className="text-red-600">{row.reason}</Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          </div>
        </div>
      )}

      {/* Spreadsheet-style change grid */}
      {preview.assetsToUpdate.length > 0 && (
        <div>
          <SpreadsheetPreview
            assets={preview.assetsToUpdate}
            columns={preview.updatableColumns}
            displayLimit={PREVIEW_DISPLAY_LIMIT}
            totalChanges={totalChanges}
          />
        </div>
      )}

      {/* Skipped assets (collapsible) */}
      {preview.skippedAssets.length > 0 && (
        <details className="mb-4">
          <summary className="cursor-pointer text-sm text-gray-500">
            {preview.skippedAssets.length} asset
            {preview.skippedAssets.length !== 1 ? "s" : ""} with no changes
            (click to expand)
          </summary>
          <div className="mt-2 max-h-[200px] overflow-y-auto rounded-md border">
            <Table className="[&_td]:px-2 [&_td]:py-1.5 [&_th]:px-2 [&_th]:py-1.5">
              <thead className="sticky top-0 bg-gray-50">
                <Tr>
                  <Th>Asset</Th>
                  <Th>Reason</Th>
                </Tr>
              </thead>
              <tbody>
                {preview.skippedAssets.map((asset, i) => (
                  <Tr key={i}>
                    <Td>{asset.title}</Td>
                    <Td className="text-gray-500">{asset.reason}</Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          </div>
        </details>
      )}

      {/* Apply confirmation */}
      {preview.assetsToUpdate.length > 0 && (
        <div className="mt-2 flex items-center gap-3">
          <AlertDialog
            onOpenChange={(open) => {
              if (!open) {
                setAgreed("");
              }
            }}
          >
            <AlertDialogTrigger asChild>
              <Button type="button">
                Apply {totalChanges} change
                {totalChanges !== 1 ? "s" : ""} to {totalAssets} asset
                {totalAssets !== 1 ? "s" : ""}
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent className="max-w-[600px]">
              <AlertDialogHeader>
                <AlertDialogTitle>Confirm bulk update</AlertDialogTitle>
                <AlertDialogDescription>
                  You are about to apply{" "}
                  <strong>
                    {totalChanges} change
                    {totalChanges !== 1 ? "s" : ""}
                  </strong>{" "}
                  across <strong>{totalAssets}</strong> asset
                  {totalAssets !== 1 ? "s" : ""}. This action cannot be undone.
                  Empty cells will clear existing values where applicable.
                </AlertDialogDescription>
                {hasNewEntities && (
                  <AlertDialogDescription>
                    <span className="text-amber-600">
                      This will also create{" "}
                      {[
                        preview.newEntities.categories.length > 0 &&
                          `${
                            preview.newEntities.categories.length
                          } new categor${
                            preview.newEntities.categories.length !== 1
                              ? "ies"
                              : "y"
                          }`,
                        preview.newEntities.locations.length > 0 &&
                          `${
                            preview.newEntities.locations.length
                          } new location${
                            preview.newEntities.locations.length !== 1
                              ? "s"
                              : ""
                          }`,
                        preview.newEntities.tags.length > 0 &&
                          `${preview.newEntities.tags.length} new tag${
                            preview.newEntities.tags.length !== 1 ? "s" : ""
                          }`,
                      ]
                        .filter(Boolean)
                        .join(", ")}
                      .
                    </span>
                  </AlertDialogDescription>
                )}
                <AlertDialogDescription>
                  Type <b>"I AGREE"</b> below to confirm.
                </AlertDialogDescription>
                {/* Server-side apply error shown inside the dialog */}
                {applyFetcher.data?.error && (
                  <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-600">
                    {applyFetcher.data.error.message ||
                      "An error occurred while applying changes."}
                  </div>
                )}
                <Input
                  type="text"
                  label="Confirmation"
                  autoFocus
                  name="agree"
                  value={agreed}
                  onChange={(e) => setAgreed(e.target.value.toUpperCase())}
                  placeholder="I AGREE"
                  pattern="^I AGREE$"
                  required
                  onKeyDown={(e) => {
                    if (
                      e.key === "Enter" &&
                      agreed === "I AGREE" &&
                      !isApplyLoading
                    ) {
                      e.preventDefault();
                      submitApply();
                    }
                  }}
                />
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel asChild>
                  <Button type="button" variant="secondary">
                    Cancel
                  </Button>
                </AlertDialogCancel>
                <Button
                  type="button"
                  disabled={agreed !== "I AGREE" || isApplyLoading}
                  onClick={submitApply}
                >
                  {isApplyLoading
                    ? "Applying..."
                    : `Apply ${totalChanges} change${
                        totalChanges !== 1 ? "s" : ""
                      }`}
                </Button>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
          <Button type="button" variant="secondary" onClick={onReset}>
            Start over
          </Button>
        </div>
      )}

      {preview.assetsToUpdate.length === 0 && (
        <p className="mt-4 text-gray-500">
          No changes detected. All assets are already up to date, or all rows
          failed validation.
        </p>
      )}
    </div>
  );
}
