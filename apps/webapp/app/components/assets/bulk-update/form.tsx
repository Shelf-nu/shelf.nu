/**
 * @file Orchestrates the bulk asset update CSV import flow.
 * Manages three stages: upload (file selection + client validation),
 * preview (server analysis), and results (post-apply summary).
 *
 * @see {@link file://./preview-display.tsx} Preview stage component
 * @see {@link file://./results-display.tsx} Results stage component
 * @see {@link file://./../../../routes/_layout+/assets.import-update.tsx} Route action
 */
import type React from "react";
import type { ChangeEvent } from "react";
import { useCallback, useEffect, useReducer, useRef } from "react";
import { useDisabled } from "~/hooks/use-disabled";
import useFetcherWithReset from "~/hooks/use-fetcher-with-reset";
import type { action } from "~/routes/_layout+/assets.import-update";
import type {
  UpdatePreview,
  BulkUpdateResult,
} from "~/utils/import-update.server";
import { validateCsvClientSide, type ClientValidation } from "./helpers";
import { PreviewDisplay } from "./preview-display";
import { ResultsDisplay } from "./results-display";
import { ClientValidationFeedback, DefectedHeadersTable } from "./shared";
import Input from "../../forms/input";
import { Button } from "../../shared/button";
import When from "../../when/when";

// ---------------------------------------------------------------------------
// Update Import Form (main orchestration component)
// ---------------------------------------------------------------------------

type Stage = "upload" | "preview" | "results";

/** Consolidated state for the bulk update import flow. */
type ImportState = {
  selectedFile: File | null;
  clientValidation: ClientValidation | null;
  stage: Stage;
  preview: UpdatePreview | null;
  result: BulkUpdateResult | null;
  agreed: string;
};

type ImportAction =
  | { type: "file_selected"; file: File }
  | { type: "client_validation"; validation: ClientValidation }
  | { type: "preview_loaded"; preview: UpdatePreview }
  | { type: "result_loaded"; result: BulkUpdateResult }
  | { type: "set_agreed"; value: string }
  | { type: "reset_for_new_file" }
  | { type: "reset" };

const INITIAL_IMPORT_STATE: ImportState = {
  selectedFile: null,
  clientValidation: null,
  stage: "upload",
  preview: null,
  result: null,
  agreed: "",
};

function importReducer(state: ImportState, action: ImportAction): ImportState {
  switch (action.type) {
    case "file_selected":
      // Start over (in upload stage) whenever a new file is chosen
      return {
        ...INITIAL_IMPORT_STATE,
        selectedFile: action.file,
      };
    case "client_validation":
      return { ...state, clientValidation: action.validation };
    case "preview_loaded":
      return { ...state, preview: action.preview, stage: "preview" };
    case "result_loaded":
      return { ...state, result: action.result, stage: "results" };
    case "set_agreed":
      return { ...state, agreed: action.value };
    case "reset_for_new_file":
      return { ...INITIAL_IMPORT_STATE, selectedFile: state.selectedFile };
    case "reset":
      return INITIAL_IMPORT_STATE;
    default:
      return state;
  }
}

/**
 * Main orchestration component for the bulk asset update CSV import.
 * Manages a three-stage flow: file upload with client-side validation,
 * server-side preview analysis, and post-apply results display.
 */
export function UpdateImportForm({
  onStageChange,
}: {
  /** Called when the form transitions between stages (upload/preview/results) */
  onStageChange?: (stage: Stage) => void;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const previewFetcher = useFetcherWithReset<typeof action>();
  const applyFetcher = useFetcherWithReset<typeof action>();

  const [state, dispatch] = useReducer(importReducer, INITIAL_IMPORT_STATE);
  const { selectedFile, clientValidation, stage, preview, result, agreed } =
    state;
  const lastProcessedPreview = useRef<UpdatePreview | null>(null);
  const lastProcessedResult = useRef<BulkUpdateResult | null>(null);
  const activeFileNonce = useRef(0);

  const isPreviewLoading = useDisabled(previewFetcher);
  const isApplyLoading = useDisabled(applyFetcher);

  const processFile = useCallback(
    (file: File) => {
      dispatch({ type: "file_selected", file });
      previewFetcher.reset();
      applyFetcher.reset();

      // Client-side validation: read first few KB to check headers
      // Use a nonce to ignore stale FileReader results from a previous file
      const nonce = ++activeFileNonce.current;
      const reader = new FileReader();
      reader.onload = () => {
        if (nonce !== activeFileNonce.current) return;
        const text = reader.result as string;
        const validation = validateCsvClientSide(text);
        dispatch({ type: "client_validation", validation });
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
      if (isPreviewLoading || isApplyLoading) return;
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
    [processFile, isPreviewLoading, isApplyLoading]
  );

  // Handle preview response — use optional chaining instead of type casts.
  // The fetcher is already typed via useFetcherWithReset<typeof action>,
  // so we access properties defensively with optional chaining.
  const previewData = previewFetcher.data;

  useEffect(() => {
    if (!previewData || previewData.error) return;

    const fetchedPreview =
      "preview" in previewData
        ? (previewData.preview as UpdatePreview)
        : undefined;

    if (
      "intent" in previewData &&
      previewData.intent === "preview-update" &&
      fetchedPreview &&
      fetchedPreview !== lastProcessedPreview.current
    ) {
      lastProcessedPreview.current = fetchedPreview;
      dispatch({ type: "preview_loaded", preview: fetchedPreview });
      onStageChange?.("preview");
    }
  }, [previewData, onStageChange]);

  // Handle apply response — same pattern, no type cast needed.
  const applyData = applyFetcher.data;

  useEffect(() => {
    if (!applyData || applyData.error) return;

    const fetchedResult =
      "result" in applyData
        ? (applyData.result as BulkUpdateResult)
        : undefined;

    if (
      "intent" in applyData &&
      applyData.intent === "apply-update" &&
      fetchedResult &&
      fetchedResult !== lastProcessedResult.current
    ) {
      lastProcessedResult.current = fetchedResult;
      dispatch({ type: "result_loaded", result: fetchedResult });
      onStageChange?.("results");
    }
  }, [applyData, onStageChange]);

  const handleReset = () => {
    dispatch({ type: "reset" });
    previewFetcher.reset();
    applyFetcher.reset();
    if (formRef.current) {
      formRef.current.reset();
    }
    onStageChange?.("upload");
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
              disabled={
                stage === "results" || isPreviewLoading || isApplyLoading
              }
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
          setAgreed={(value) => dispatch({ type: "set_agreed", value })}
          applyFetcher={applyFetcher}
          isApplyLoading={isApplyLoading}
          selectedFile={selectedFile}
          onReanalyze={() => {
            dispatch({ type: "set_agreed", value: "" });
            previewFetcher.reset();
            applyFetcher.reset();
            requestAnimationFrame(() => {
              formRef.current?.requestSubmit();
            });
          }}
          isReanalyzing={isPreviewLoading}
          onReset={handleReset}
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
