/**
 * @file Upload, column mapping, preview and confirm flow of the content import.
 *
 * Three stages:
 * - `upload`: pick a CSV and press Continue. The file is posted with
 *   `intent=analyze` and comes back as a proposed column mapping.
 * - `map`: review where each column goes ({@link MappingReview}), then press
 *   Preview import. The same file is posted with `intent=preview` and the
 *   reviewed mapping; the server applies it, validates the rows and stores
 *   them as a draft import.
 * - `preview`: review the parsed rows and confirm. Confirming queues the
 *   background import and the route action redirects to the progress page,
 *   so there is no results stage here.
 *
 * A server that answers the upload with a preview straight away (no mapping
 * step) goes to the `preview` stage directly.
 *
 * The file input stays mounted through every stage (its form is hidden), so the
 * same File object is posted again. The mapping review renders outside that
 * form: Enter in one of its inputs must never submit the upload again.
 *
 * Each stage hides the others, so focus follows the stage: the preview stage
 * focuses its heading when it mounts, and going back to the upload stage
 * focuses the file input.
 *
 * @see {@link file://./preview-stage.tsx} Preview stage
 * @see {@link file://./../import-mapping/mapping-review.tsx} Mapping review table
 * @see {@link file://./import-progress.tsx} Progress view the confirm redirects to
 * @see {@link file://./../../../routes/_layout+/assets.import.tsx} Route action (`analyze`, `preview`, `confirm`)
 */
import type { ChangeEvent } from "react";
import { useEffect, useMemo, useReducer, useRef } from "react";
import { useDisabled } from "~/hooks/use-disabled";
import useFetcherWithReset from "~/hooks/use-fetcher-with-reset";
import type { ContentImportPreview } from "~/modules/asset-import/types";
import type { ExistingCustomField } from "~/modules/import-mapping/heuristics";
import {
  buildFormatNotes,
  isAlreadyShelfFormat,
} from "~/modules/import-mapping/heuristics";
import type { ColumnStats } from "~/modules/import-mapping/summary";
import { summarizeMapping } from "~/modules/import-mapping/summary";
import type {
  ColumnMapping,
  ColumnTarget,
  MappingProposal,
} from "~/modules/import-mapping/types";
import {
  customFieldNameSchema,
  findDuplicateTargets,
} from "~/modules/import-mapping/types";
import type { action } from "~/routes/_layout+/assets.import";
import { useBarcodePermissions } from "~/utils/permissions/use-barcode-permissions";
import { PreviewStage } from "./preview-stage";
import Input from "../../forms/input";
import { Button } from "../../shared/button";
import {
  MappingReview,
  existingTypeFor,
} from "../import-mapping/mapping-review";
import { ImportErrorDetails } from "../import-preview/import-error-details";

/** What the `analyze` intent returns. */
export type MappingAnalysis = {
  proposal: MappingProposal;
  rowCount: number;
  alreadyMatches: boolean;
  columnStats: ColumnStats[];
  existingCustomFields: ExistingCustomField[];
};

/** Which part of the flow is on screen. */
type Stage = "upload" | "map" | "preview";

/** State of the upload, mapping and preview flow. */
type FlowState = {
  stage: Stage;
  /** File chosen in the input; enables the Continue button. */
  selectedFile: File | null;
  /** Server analysis of the uploaded file; set from the `map` stage on. */
  analysis: MappingAnalysis | null;
  /** The mapping as the user has edited it, in file order. */
  columns: ColumnMapping[];
  /** Server preview of the mapped file; set once the stage is `preview`. */
  preview: ContentImportPreview | null;
};

/** Transitions of {@link FlowState}. */
type FlowAction =
  | { type: "file_selected"; file: File }
  | { type: "analysis_loaded"; analysis: MappingAnalysis }
  | { type: "target_changed"; index: number; target: ColumnTarget }
  | { type: "back_to_upload" }
  | { type: "preview_loaded"; preview: ContentImportPreview }
  | { type: "reset" };

const INITIAL_FLOW_STATE: FlowState = {
  stage: "upload",
  selectedFile: null,
  analysis: null,
  columns: [],
  preview: null,
};

/**
 * Reducer for {@link ContentImportFlow}. A column the user edits counts as
 * sure, and a custom field named like an existing one takes that field's
 * stored type, because the importer refuses any other.
 *
 * @param state - Current flow state
 * @param action - The transition to apply
 * @returns The next state
 */
export function flowReducer(state: FlowState, action: FlowAction): FlowState {
  switch (action.type) {
    case "file_selected":
      // A new file starts the flow over, in the upload stage.
      return { ...INITIAL_FLOW_STATE, selectedFile: action.file };
    case "analysis_loaded":
      return {
        ...state,
        stage: "map",
        analysis: action.analysis,
        columns: action.analysis.proposal.columns,
        preview: null,
      };
    case "target_changed": {
      if (!state.analysis) return state;
      let target = action.target;
      if (target.kind === "customField") {
        const existingType = existingTypeFor(
          state.analysis.existingCustomFields,
          target.name
        );
        if (existingType) target = { ...target, type: existingType };
      }
      return {
        ...state,
        columns: state.columns.map((column, index) =>
          index === action.index
            ? { ...column, target, confidence: "high" as const }
            : column
        ),
      };
    }
    case "back_to_upload":
      // Keeps the chosen file, so Continue analyses it again.
      return { ...state, stage: "upload", analysis: null, columns: [] };
    case "preview_loaded":
      return { ...state, stage: "preview", preview: action.preview };
    case "reset":
      return INITIAL_FLOW_STATE;
    default:
      return state;
  }
}

/** Props for {@link ContentImportFlow}. */
type ContentImportFlowProps = {
  /** True while another import runs in the workspace: the upload is held. */
  uploadBlocked?: boolean;
};

/**
 * Upload form, column mapping review and preview for a content import. Owns
 * three fetchers: the analyze fetcher posts the file (`intent=analyze`), the
 * preview fetcher posts it again with the reviewed mapping (`intent=preview`),
 * and the confirm fetcher posts the draft's id (`intent=confirm`).
 *
 * @param props - See {@link ContentImportFlowProps}
 * @returns The upload form, the mapping review or the preview stage
 */
export function ContentImportFlow({
  uploadBlocked = false,
}: ContentImportFlowProps) {
  const { canUseBarcodes } = useBarcodePermissions();
  const formRef = useRef<HTMLFormElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  /** Set when going back to upload, so the upload stage takes focus back. */
  const refocusFileInput = useRef(false);
  const analyzeFetcher = useFetcherWithReset<typeof action>();
  const previewFetcher = useFetcherWithReset<typeof action>();
  const confirmFetcher = useFetcherWithReset<typeof action>();
  const [state, dispatch] = useReducer(flowReducer, INITIAL_FLOW_STATE);
  const { stage, selectedFile, preview, analysis, columns } = state;
  const lastProcessedAnalysis = useRef<unknown>(null);
  const lastProcessedPreview = useRef<ContentImportPreview | null>(null);
  const isAnalyzing = useDisabled(analyzeFetcher);
  const isPreviewLoading = useDisabled(previewFetcher);

  // The upload answers with an analysis, or (from a server without the
  // mapping step) with a preview straight away.
  const analyzeData = analyzeFetcher.data;
  useEffect(() => {
    if (!analyzeData || analyzeData.error) return;
    if (analyzeData === lastProcessedAnalysis.current) return;
    lastProcessedAnalysis.current = analyzeData;
    if ("intent" in analyzeData && analyzeData.intent === "analyze") {
      dispatch({
        type: "analysis_loaded",
        analysis: analyzeData as unknown as MappingAnalysis,
      });
    } else if ("intent" in analyzeData && analyzeData.intent === "preview") {
      lastProcessedPreview.current = analyzeData.preview;
      dispatch({ type: "preview_loaded", preview: analyzeData.preview });
    }
  }, [analyzeData]);

  const previewData = previewFetcher.data;
  useEffect(() => {
    if (!previewData || previewData.error) return;
    if (
      "intent" in previewData &&
      previewData.intent === "preview" &&
      previewData.preview !== lastProcessedPreview.current
    ) {
      lastProcessedPreview.current = previewData.preview;
      dispatch({ type: "preview_loaded", preview: previewData.preview });
    }
  }, [previewData]);

  useEffect(() => {
    if (stage === "upload" && refocusFileInput.current) {
      refocusFileInput.current = false;
      fileInputRef.current?.focus();
    }
  }, [stage]);

  const duplicateRows = useMemo(
    () => new Set([...findDuplicateTargets(columns).values()].flat()),
    [columns]
  );
  const hasInvalidName = columns.some(
    ({ target }) =>
      target.kind === "customField" &&
      !customFieldNameSchema.safeParse(target.name).success
  );
  const allSkipped =
    columns.length > 0 && columns.every(({ target }) => target.kind === "skip");
  const summary = analysis
    ? summarizeMapping({
        columns,
        stats: analysis.columnStats,
        rowCount: analysis.rowCount,
        existingCustomFieldNames: analysis.existingCustomFields.map(
          ({ name }) => name
        ),
      })
    : null;

  const handleFileSelect = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      dispatch({ type: "file_selected", file });
      analyzeFetcher.reset();
      previewFetcher.reset();
      confirmFetcher.reset();
      lastProcessedAnalysis.current = null;
    }
  };

  const handleReset = () => {
    dispatch({ type: "reset" });
    analyzeFetcher.reset();
    previewFetcher.reset();
    confirmFetcher.reset();
    lastProcessedAnalysis.current = null;
    lastProcessedPreview.current = null;
    refocusFileInput.current = true;
    formRef.current?.reset();
  };

  const handleBackToUpload = () => {
    dispatch({ type: "back_to_upload" });
    analyzeFetcher.reset();
    previewFetcher.reset();
    refocusFileInput.current = true;
  };

  /** Posts the same file with the reviewed mapping for the server preview. */
  const submitPreview = () => {
    if (!analysis || !summary || !formRef.current) return;
    const original = analysis.proposal.columns;
    const changed = columns.filter(
      (column, index) =>
        JSON.stringify(column.target) !==
        JSON.stringify(original[index]?.target)
    ).length;

    const formData = new FormData(formRef.current);
    formData.set("intent", "preview");
    // Samples are display-only; leaving them out keeps the post small.
    formData.set(
      "mapping",
      JSON.stringify(columns.map((column) => ({ ...column, sample: [] })))
    );
    formData.set("mappingChanged", String(changed));
    // The review already knows which custom fields are new; the server only
    // reports the count, so it need not load the workspace's fields again.
    formData.set(
      "mappingNewCustomFields",
      String(summary.newCustomFields.length)
    );
    void previewFetcher.submit(formData, {
      method: "post",
      encType: "multipart/form-data",
    });
  };

  return (
    <>
      <analyzeFetcher.Form
        className="mt-4 w-full"
        method="post"
        ref={formRef}
        encType="multipart/form-data"
        hidden={stage !== "upload"}
      >
        <Input
          ref={fileInputRef}
          type="file"
          name="file"
          label="Select a csv file"
          required
          onChange={handleFileSelect}
          accept=".csv"
          disabled={isAnalyzing || uploadBlocked}
        />
        <input type="hidden" name="intent" value="analyze" />

        {analyzeFetcher.data?.error ? (
          <div className="mt-4 rounded-md border border-red-200 bg-red-50 p-4">
            <ImportErrorDetails error={analyzeFetcher.data.error} />
          </div>
        ) : null}

        <Button
          type="submit"
          className="my-4"
          disabled={!selectedFile || isAnalyzing || uploadBlocked}
        >
          {isAnalyzing ? "Reading your file..." : "Continue"}
        </Button>
      </analyzeFetcher.Form>

      {stage === "map" && analysis && summary ? (
        <section aria-labelledby="mapping-review-title" className="mt-4">
          <h4 id="mapping-review-title">Check how your columns map</h4>
          <p className="text-[14px] text-gray-600">
            {selectedFile ? <b>{selectedFile.name}</b> : "Your file"}: each
            column goes to the Shelf field on its right. Change any that look
            wrong, or set them to Skip.
          </p>

          <MappingReview
            columns={columns}
            onChange={(index, target) =>
              dispatch({ type: "target_changed", index, target })
            }
            duplicateRows={duplicateRows}
            existingCustomFields={analysis.existingCustomFields}
            canUseBarcodes={canUseBarcodes}
            // Recomputed from the edited mapping, so a note goes away once the
            // column it warns about is remapped.
            notes={buildFormatNotes(columns)}
            alreadyMatches={isAlreadyShelfFormat(columns)}
            summary={summary}
          />

          {duplicateRows.size > 0 ? (
            <p role="alert" className="mt-2 text-[14px] text-error-600">
              Two or more columns go to the same Shelf field. Fix the rows
              marked above to continue.
            </p>
          ) : null}

          {previewFetcher.data?.error ? (
            <div className="mt-4 rounded-md border border-red-200 bg-red-50 p-4">
              <ImportErrorDetails error={previewFetcher.data.error} />
            </div>
          ) : null}

          <div className="flex gap-3">
            <Button
              type="button"
              variant="secondary"
              className="my-4"
              onClick={handleBackToUpload}
            >
              Back
            </Button>
            <Button
              type="button"
              className="my-4"
              onClick={submitPreview}
              disabled={
                duplicateRows.size > 0 ||
                hasInvalidName ||
                allSkipped ||
                isPreviewLoading
              }
            >
              {isPreviewLoading ? "Checking file..." : "Preview import"}
            </Button>
          </div>
        </section>
      ) : null}

      {stage === "preview" && preview ? (
        <PreviewStage
          preview={preview}
          onReset={handleReset}
          confirmFetcher={confirmFetcher}
        />
      ) : null}
    </>
  );
}
