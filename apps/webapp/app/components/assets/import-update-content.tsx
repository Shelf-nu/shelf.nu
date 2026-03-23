import type React from "react";
import type { ChangeEvent } from "react";
import { useCallback, useRef, useState } from "react";
import useFetcherWithReset from "~/hooks/use-fetcher-with-reset";
import type { action } from "~/routes/_layout+/assets.import-update";
import { isFormProcessing } from "~/utils/form";
import type {
  AssetChangePreview,
  UpdatePreview,
  BulkUpdateResult,
} from "~/utils/import-update.server";
import Input from "../forms/input";
import Icon from "../icons/icon";
import { Button } from "../shared/button";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "../shared/modal";
import { Table, Td, Th, Tr } from "../table";
import When from "../when/when";

/** Maximum number of asset change rows to display in the preview */
const PREVIEW_DISPLAY_LIMIT = 50;

// ---------------------------------------------------------------------------
// Client-side CSV header validation
// ---------------------------------------------------------------------------

/** Identifier columns we accept, in order of preference */
const ACCEPTED_ID_COLUMNS = ["Asset ID", "ID"] as const;

interface ClientValidation {
  valid: boolean;
  /** Which identifier column was found (null if none) */
  idColumnFound: string | null;
  headerCount: number;
  rowCount: number;
  warnings: string[];
}

function validateCsvClientSide(text: string): ClientValidation {
  // Strip BOM that Excel adds to UTF-8 CSVs
  const cleanText = text.replace(/^\uFEFF/, "");
  const lines = cleanText.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length === 0) {
    return {
      valid: false,
      idColumnFound: null,
      headerCount: 0,
      rowCount: 0,
      warnings: ["File appears to be empty."],
    };
  }

  // Parse first line as headers (simple CSV split — handles most cases)
  const headers = parseSimpleCsvLine(lines[0]);
  const headerTrimmed = headers.map((h) => h.trim());

  // Find best available identifier column (priority order)
  const idColumnFound =
    ACCEPTED_ID_COLUMNS.find((col) => headerTrimmed.includes(col)) ?? null;

  const rowCount = Math.max(0, lines.length - 1);
  const warnings: string[] = [];

  if (!idColumnFound) {
    warnings.push(
      "No identifier column found. Your CSV needs an Asset ID or ID column to match rows to existing assets."
    );
  }

  if (rowCount === 0) {
    warnings.push("No data rows found — only a header row.");
  }

  return {
    valid: !!idColumnFound && rowCount > 0,
    idColumnFound,
    headerCount: headerTrimmed.filter(Boolean).length,
    rowCount,
    warnings,
  };
}

/** Simple CSV line parser for client-side validation.
 *  Handles quoted values and strips enclosing quotes. */
function parseSimpleCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if ((char === "," || char === ";") && !inQuotes) {
      result.push(stripQuotes(current.trim()));
      current = "";
    } else {
      current += char;
    }
  }
  result.push(stripQuotes(current.trim()));
  return result;
}

/** Strip enclosing double-quotes from a CSV value */
function stripQuotes(value: string): string {
  if (value.startsWith('"') && value.endsWith('"')) {
    return value.slice(1, -1);
  }
  return value;
}

// ---------------------------------------------------------------------------
// Main Export
// ---------------------------------------------------------------------------

export const ImportUpdateContent = () => (
  <div className="w-full text-left">
    <h3>Update existing assets</h3>
    <p>
      Edit your assets in Excel or Google Sheets, then upload the CSV here.
      We'll show you exactly what will change before anything is saved.
    </p>

    {/* Step 1: Get the CSV */}
    <div className="my-4 flex items-center gap-3 rounded-md border border-gray-200 bg-gray-50 p-4">
      <Icon icon="download" size="xs" className="shrink-0 text-gray-500" />
      <div className="flex-1">
        <p className="text-[14px] text-gray-600">
          <b>Step 1:</b> Go to the{" "}
          <Button variant="link" to="/assets">
            Asset Index
          </Button>
          , select the assets you want to update, and click{" "}
          <b>Export selection</b>.
        </p>
      </div>
      <Button variant="secondary" to="/assets">
        Go to Asset Index
      </Button>
    </div>

    <div className="my-5 flex flex-col gap-4">
      {/* What you can update */}
      <div className="flex gap-3">
        <Icon icon="pen" size="xs" className="mt-0.5 shrink-0 text-gray-500" />
        <div>
          <h5 className="font-semibold">What you can update</h5>
          <p className="text-[14px] text-gray-600">
            Name, Category, Location, Tags, Valuation, Available to book, and
            your custom fields (Text, Boolean, Date, Option, Number, Currency).
          </p>
          <p className="mt-1 text-[14px] text-gray-600">
            <b>Not supported yet:</b> Description, Status, Kit, and Custody
            can't be bulk-updated via CSV — Status and Custody have their own
            workflows, and Description can lose formatting during export. These
            columns will be safely skipped if present in your file.
          </p>
        </div>
      </div>

      {/* Empty cells */}
      <div className="flex gap-3">
        <Icon
          icon="check"
          size="xs"
          className="mt-0.5 shrink-0 text-gray-500"
        />
        <div>
          <h5 className="font-semibold">Empty cells are safe</h5>
          <p className="text-[14px] text-gray-600">
            We only touch cells that have a value. Leave a cell blank and that
            field stays as-is.
          </p>
        </div>
      </div>

      {/* Matching */}
      <div className="flex gap-3">
        <Icon
          icon="asset"
          size="xs"
          className="mt-0.5 shrink-0 text-gray-500"
        />
        <div>
          <h5 className="font-semibold">How assets are matched</h5>
          <p className="text-[14px] text-gray-600">
            By <b>Asset ID</b> or <b>ID</b> — keep these columns as they are.
            Categories, locations, and tags that don't exist yet will be created
            for you.
          </p>
        </div>
      </div>
    </div>

    <p className="text-[14px] text-gray-500">
      💡 Just need to change one field on many assets? Select them in the{" "}
      <Button variant="link" to="/assets">
        Asset Index
      </Button>{" "}
      and use <b>Actions</b> — no CSV needed.
    </p>

    <p className="mt-1 text-[14px] text-gray-400">
      Looking to create new assets instead?{" "}
      <Button variant="link" to="/assets/import">
        Use the standard import
      </Button>
    </p>

    <UpdateImportForm />
  </div>
);

// ---------------------------------------------------------------------------
// Form Component
// ---------------------------------------------------------------------------

type Stage = "upload" | "preview" | "results";

function UpdateImportForm() {
  const formRef = useRef<HTMLFormElement>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const previewFetcher = useFetcherWithReset<typeof action>();
  const applyFetcher = useFetcherWithReset<typeof action>();

  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [clientValidation, setClientValidation] =
    useState<ClientValidation | null>(null);
  const [stage, setStage] = useState<Stage>("upload");
  const [preview, setPreview] = useState<UpdatePreview | null>(null);
  const [result, setResult] = useState<BulkUpdateResult | null>(null);
  const [agreed, setAgreed] = useState<"I AGREE" | "">("");
  const lastProcessedPreview = useRef<UpdatePreview | null>(null);

  const isPreviewLoading = isFormProcessing(previewFetcher.state);
  const isApplyLoading = isFormProcessing(applyFetcher.state);

  const processFile = useCallback(
    (file: File) => {
      setSelectedFile(file);
      setStage("upload");
      setPreview(null);
      setResult(null);
      setClientValidation(null);
      previewFetcher.reset();
      applyFetcher.reset();

      // Client-side validation: read first few KB to check headers
      const reader = new FileReader();
      reader.onload = () => {
        const text = reader.result as string;
        const validation = validateCsvClientSide(text);
        setClientValidation(validation);
      };
      // Read enough to get headers + a few rows
      reader.readAsText(file.slice(0, 50_000));
    },
    [previewFetcher, applyFetcher]
  );

  const handleFileSelect = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event?.target?.files?.[0];
    if (file) {
      processFile(file);
    }
  };

  // Handle paste anywhere on the upload area
  const handlePaste = useCallback(
    (event: React.ClipboardEvent) => {
      const text = event.clipboardData.getData("text/plain");
      if (!text.trim()) return;

      // Convert pasted text to a File object
      const blob = new Blob([text], { type: "text/csv" });
      const file = new File([blob], "pasted-data.csv", { type: "text/csv" });

      // Set the file on the hidden input via DataTransfer
      const dt = new DataTransfer();
      dt.items.add(file);
      if (fileInputRef.current) {
        fileInputRef.current.files = dt.files;
      }

      processFile(file);
    },
    [processFile]
  );

  // Handle preview response
  const previewData = previewFetcher.data as
    | {
        error?: unknown;
        success?: boolean;
        intent?: string;
        preview?: UpdatePreview;
      }
    | undefined;

  if (
    previewData &&
    !previewData.error &&
    previewData.intent === "preview-update" &&
    previewData.preview &&
    previewData.preview !== lastProcessedPreview.current &&
    (stage === "upload" || stage === "preview")
  ) {
    lastProcessedPreview.current = previewData.preview;
    setPreview(previewData.preview);
    setStage("preview");
  }

  // Handle apply response
  const applyData = applyFetcher.data as
    | {
        error?: unknown;
        success?: boolean;
        intent?: string;
        result?: BulkUpdateResult;
      }
    | undefined;

  if (
    applyData &&
    !applyData.error &&
    applyData.intent === "apply-update" &&
    applyData.result &&
    stage === "preview"
  ) {
    setResult(applyData.result);
    setStage("results");
  }

  const handleReset = () => {
    setSelectedFile(null);
    setClientValidation(null);
    setStage("upload");
    setPreview(null);
    setResult(null);
    setAgreed("");
    previewFetcher.reset();
    applyFetcher.reset();
    if (formRef.current) {
      formRef.current.reset();
    }
  };

  const canAnalyze =
    selectedFile && clientValidation?.valid && !isPreviewLoading;

  return (
    <>
      {/* File upload form */}
      <previewFetcher.Form
        className="mt-4 w-full"
        method="post"
        ref={formRef}
        encType="multipart/form-data"
      >
        {/* Upload area with paste support */}
        <div
          className="rounded-lg border-2 border-dashed border-gray-300 p-6 transition-colors focus-within:border-primary-400 hover:border-gray-400"
          onPaste={handlePaste}
        >
          <div className="text-center">
            <p className="mb-2 text-sm text-gray-600">
              <span className="font-medium text-gray-900">Click to upload</span>{" "}
              or paste CSV content here
            </p>
            <p className="text-xs text-gray-500">
              CSV file exported from Asset Index (.csv)
            </p>
          </div>

          <div className="mt-3">
            <Input
              type="file"
              name="file"
              label="CSV file"
              hideLabel
              required
              onChange={handleFileSelect}
              accept=".csv"
              disabled={stage === "results"}
              ref={fileInputRef}
            />
          </div>
        </div>

        <input type="hidden" name="intent" value="preview-update" />

        {/* Client-side validation feedback */}
        {clientValidation && selectedFile && (
          <ClientValidationFeedback
            validation={clientValidation}
            fileName={selectedFile.name}
          />
        )}

        {/* Preview error display */}
        <When truthy={!!previewFetcher.data?.error}>
          <div className="mt-4 rounded-md border border-red-200 bg-red-50 p-4">
            <h5 className="text-red-500">
              {previewFetcher.data?.error?.title || "Import Error"}
            </h5>
            <p className="text-red-500">
              {previewFetcher.data?.error?.message}
            </p>
            {Array.isArray(
              previewFetcher.data?.error?.additionalData?.defectedHeaders
            ) ? (
              <DefectedHeadersTable
                data={
                  previewFetcher.data.error.additionalData.defectedHeaders as {
                    incorrectHeader: string;
                    errorMessage: string;
                  }[]
                }
              />
            ) : null}
          </div>
        </When>

        {stage === "upload" && (
          <Button type="submit" disabled={!canAnalyze} className="my-4">
            {isPreviewLoading ? "Analyzing..." : "Analyze file"}
          </Button>
        )}
      </previewFetcher.Form>

      {/* Preview stage */}
      {stage === "preview" && preview && (
        <PreviewDisplay
          preview={preview}
          formRef={formRef}
          agreed={agreed}
          setAgreed={setAgreed}
          applyFetcher={applyFetcher}
          isApplyLoading={isApplyLoading}
          selectedFile={selectedFile}
          onReanalyze={() => {
            // Re-submit the same file for fresh analysis
            setAgreed("");
            previewFetcher.reset();
            applyFetcher.reset();
            // Submit the existing form (file input still has the file)
            requestAnimationFrame(() => {
              formRef.current?.requestSubmit();
            });
          }}
          isReanalyzing={isPreviewLoading}
        />
      )}

      {/* Apply error display */}
      <When truthy={stage === "preview" && !!applyFetcher.data?.error}>
        <div className="mt-4 rounded-md border border-red-200 bg-red-50 p-4">
          <h5 className="text-red-500">
            {applyFetcher.data?.error?.title || "Update Error"}
          </h5>
          <p className="text-red-500">{applyFetcher.data?.error?.message}</p>
        </div>
      </When>

      {/* Results stage */}
      {stage === "results" && result && (
        <ResultsDisplay result={result} onReset={handleReset} />
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Client Validation Feedback
// ---------------------------------------------------------------------------

function ClientValidationFeedback({
  validation,
  fileName,
}: {
  validation: ClientValidation;
  fileName: string;
}) {
  return (
    <div className="mt-3 rounded-md border bg-gray-50 p-3 text-sm">
      <p className="mb-1 font-medium text-gray-700">
        File: <span className="font-normal">{fileName}</span>
      </p>
      <div className="flex items-center gap-4 text-gray-600">
        <span className="flex items-center gap-1">
          {validation.idColumnFound ? (
            <>
              <span className="text-green-600">✓</span>
              Matching by {validation.idColumnFound}
            </>
          ) : (
            <>
              <span className="text-red-500">✗</span>
              No identifier column found
            </>
          )}
        </span>
        <span>{validation.headerCount} columns</span>
        <span>{validation.rowCount} data rows</span>
      </div>
      {validation.warnings.length > 0 && (
        <div className="mt-2 space-y-1">
          {validation.warnings.map((w, i) => (
            <p key={i} className="text-amber-600">
              ⚠ {w}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Preview Display
// ---------------------------------------------------------------------------

function PreviewDisplay({
  preview,
  formRef,
  agreed,
  setAgreed,
  applyFetcher,
  isApplyLoading,
  selectedFile,
  onReanalyze,
  isReanalyzing,
}: {
  preview: UpdatePreview;
  formRef: React.RefObject<HTMLFormElement | null>;
  agreed: string;
  setAgreed: (v: "I AGREE" | "") => void;
  applyFetcher: ReturnType<typeof useFetcherWithReset<typeof action>>;
  isApplyLoading: boolean;
  selectedFile: File | null;
  onReanalyze: () => void;
  isReanalyzing: boolean;
}) {
  const applyFormRef = useRef<HTMLFormElement>(null);

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

      {/* Unrecognized columns — the user added columns that don't exist as fields */}
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

      {/* Known but unsupported columns — structural info, not about user edits */}
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
            ⚠ New items will be created
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

      {/* Failed rows — shown prominently when present */}
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
        <SpreadsheetPreview
          assets={preview.assetsToUpdate}
          columns={preview.updatableColumns}
          displayLimit={PREVIEW_DISPLAY_LIMIT}
          totalChanges={totalChanges}
        />
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

      {/* Apply confirmation — only show if there are assets to update */}
      {preview.assetsToUpdate.length > 0 && (
        <applyFetcher.Form
          method="post"
          encType="multipart/form-data"
          ref={applyFormRef}
        >
          <input type="hidden" name="intent" value="apply-update" />
          <AlertDialog
            onOpenChange={(open) => {
              if (!open) {
                setAgreed("");
              }
            }}
          >
            <AlertDialogTrigger asChild>
              <Button type="button" className="mt-2">
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
                  Empty cells will be left unchanged.
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
                <Input
                  type="text"
                  label="Confirmation"
                  autoFocus
                  name="agree"
                  value={agreed}
                  onChange={(e) =>
                    setAgreed(e.target.value.toUpperCase() as any)
                  }
                  placeholder="I AGREE"
                  pattern="^I AGREE$"
                  required
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && agreed === "I AGREE") {
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
        </applyFetcher.Form>
      )}

      {preview.assetsToUpdate.length === 0 && (
        <p className="mt-4 text-gray-500">
          No changes detected. All assets are already up to date, or all rows
          failed validation.
        </p>
      )}
    </div>
  );

  function submitApply() {
    if (!formRef.current || !selectedFile) return;
    const fd = new FormData(formRef.current);
    fd.set("intent", "apply-update");
    void applyFetcher.submit(fd, {
      method: "post",
      encType: "multipart/form-data",
    });
  }
}

// ---------------------------------------------------------------------------
// Spreadsheet-style Preview Grid
// ---------------------------------------------------------------------------

function SpreadsheetPreview({
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
                        className={`relative cursor-default border-r px-3 py-1.5 ${
                          hasWarning ? "bg-red-50" : "bg-blue-50"
                        }`}
                        onMouseEnter={() => setHoveredCell({ assetIdx, col })}
                        onMouseLeave={() => setHoveredCell(null)}
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
                          <div className="absolute bottom-full left-1/2 z-30 mb-2 w-max max-w-[280px] -translate-x-1/2 rounded-md border bg-white px-3 py-2 text-xs shadow-lg">
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

// ---------------------------------------------------------------------------
// Results Display
// ---------------------------------------------------------------------------

function ResultsDisplay({
  result,
  onReset,
}: {
  result: BulkUpdateResult;
  onReset: () => void;
}) {
  const handleDownloadReport = () => {
    const lines: string[] = ["Status,Asset ID,Asset Name,Details"];

    for (const asset of result.updated) {
      lines.push(
        `Updated,"${asset.id}","${escapeCsvValue(asset.title)}",${
          asset.changesApplied
        } fields changed`
      );
    }
    for (const asset of result.skipped) {
      lines.push(
        `Skipped,"${asset.id}","${escapeCsvValue(
          asset.title
        )}","${escapeCsvValue(asset.reason)}"`
      );
    }
    for (const row of result.failed) {
      lines.push(
        `Failed,"${row.id}","${escapeCsvValue(row.title)}","${escapeCsvValue(
          row.error
        )}"`
      );
    }

    const csv = lines.join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `bulk-update-report-${new Date()
      .toISOString()
      .slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="mt-4 w-full">
      <h4 className="mb-3">Update complete</h4>

      {/* Summary */}
      <div className="mb-4 flex gap-4 rounded-md border bg-gray-50 p-4 text-sm">
        <SummaryPill
          count={result.summary.updated}
          label="updated"
          color="green"
        />
        <SummaryPill
          count={result.summary.skipped}
          label="unchanged"
          color="gray"
        />
        <SummaryPill count={result.summary.failed} label="failed" color="red" />
      </div>

      {/* Updated assets */}
      {result.updated.length > 0 && (
        <details className="mb-3" open>
          <summary className="cursor-pointer font-medium text-green-600">
            {result.updated.length} asset
            {result.updated.length !== 1 ? "s" : ""} updated successfully
          </summary>
          <div className="mt-2 max-h-[200px] overflow-y-auto rounded-md border">
            <Table className="[&_td]:px-2 [&_td]:py-1.5 [&_th]:px-2 [&_th]:py-1.5">
              <thead className="sticky top-0 bg-green-50">
                <Tr>
                  <Th>Asset</Th>
                  <Th>Fields changed</Th>
                </Tr>
              </thead>
              <tbody>
                {result.updated.map((asset) => (
                  <Tr key={asset.id}>
                    <Td>{asset.title}</Td>
                    <Td>{asset.changesApplied}</Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          </div>
        </details>
      )}

      {/* Skipped assets */}
      {result.skipped.length > 0 && (
        <details className="mb-3">
          <summary className="cursor-pointer text-sm text-gray-500">
            {result.skipped.length} asset
            {result.skipped.length !== 1 ? "s" : ""} unchanged
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
                {result.skipped.map((asset, i) => (
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

      {/* Failed assets */}
      {result.failed.length > 0 && (
        <div className="mb-3">
          <h5 className="mb-1 font-medium text-red-600">
            {result.failed.length} row
            {result.failed.length !== 1 ? "s" : ""} failed
          </h5>
          <div className="max-h-[200px] overflow-y-auto rounded-md border border-red-200">
            <Table className="[&_td]:px-2 [&_td]:py-1.5 [&_th]:px-2 [&_th]:py-1.5">
              <thead className="sticky top-0 bg-red-50">
                <Tr>
                  <Th>Row</Th>
                  <Th>Asset</Th>
                  <Th>Error</Th>
                </Tr>
              </thead>
              <tbody>
                {result.failed.map((row, i) => (
                  <Tr key={i}>
                    <Td>{row.rowNumber}</Td>
                    <Td>{row.title || row.id || "(unknown)"}</Td>
                    <Td className="text-red-600">{row.error}</Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          </div>
        </div>
      )}

      {/* Actions */}
      <div className="mt-4 flex gap-2">
        <Button type="button" variant="secondary" onClick={onReset}>
          Import another file
        </Button>
        <Button
          type="button"
          variant="secondary"
          onClick={handleDownloadReport}
        >
          Download report
        </Button>
        <Button to="/assets">View assets</Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shared components
// ---------------------------------------------------------------------------

function SummaryPill({
  count,
  label,
  color,
}: {
  count: number;
  label: string;
  color: "blue" | "green" | "gray" | "red";
}) {
  const colorClasses = {
    blue: "bg-blue-100 text-blue-700",
    green: "bg-green-100 text-green-700",
    gray: "bg-gray-100 text-gray-700",
    red: "bg-red-100 text-red-700",
  };

  return (
    <span
      className={`rounded-full px-3 py-1 font-medium ${colorClasses[color]}`}
    >
      {count} {label}
    </span>
  );
}

function DefectedHeadersTable({
  data,
}: {
  data: { incorrectHeader: string; errorMessage: string }[];
}) {
  return (
    <table className="mt-4 w-full rounded-md border text-left text-sm">
      <thead className="bg-red-100 text-xs">
        <tr>
          <th scope="col" className="px-2 py-1">
            Unrecognized Header
          </th>
          <th scope="col" className="px-2 py-1">
            Error
          </th>
        </tr>
      </thead>
      <tbody>
        {data.map((row) => (
          <tr key={row.incorrectHeader}>
            <td className="px-2 py-1">{row.incorrectHeader}</td>
            <td className="px-2 py-1">{row.errorMessage}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Escape a value for CSV output */
function escapeCsvValue(value: string): string {
  return value.replace(/"/g, '""');
}
