/**
 * @file Upload, preview and confirm flow of the content import.
 *
 * Two stages: `upload` (pick a CSV, the server validates it and stores the
 * rows as a draft import) and `preview` (review the parsed rows, confirm).
 * Confirming queues the background import and the route action redirects to
 * the progress page, so there is no results stage here.
 *
 * Each stage hides the other, so focus follows the stage: the preview stage
 * focuses its heading when it mounts, and going back to the upload stage
 * focuses the file input.
 *
 * @see {@link file://./preview-stage.tsx} Preview stage
 * @see {@link file://./import-progress.tsx} Progress view the confirm redirects to
 * @see {@link file://./../../../routes/_layout+/assets.import.tsx} Route action (`preview`, `confirm`)
 */
import type { ChangeEvent } from "react";
import { useEffect, useReducer, useRef } from "react";
import { useDisabled } from "~/hooks/use-disabled";
import useFetcherWithReset from "~/hooks/use-fetcher-with-reset";
import type { ContentImportPreview } from "~/modules/asset-import/types";
import type { action } from "~/routes/_layout+/assets.import";
import { PreviewStage } from "./preview-stage";
import Input from "../../forms/input";
import { Button } from "../../shared/button";
import { ImportErrorDetails } from "../import-preview/import-error-details";

/** Which part of the flow is on screen. */
type Stage = "upload" | "preview";

/** State of the upload and preview flow. */
type FlowState = {
  stage: Stage;
  /** File chosen in the input; enables the preview button. */
  selectedFile: File | null;
  /** Server preview of the uploaded file; set once the stage is `preview`. */
  preview: ContentImportPreview | null;
};

/** Transitions of {@link FlowState}. */
type FlowAction =
  | { type: "file_selected"; file: File }
  | { type: "preview_loaded"; preview: ContentImportPreview }
  | { type: "reset" };

const INITIAL_FLOW_STATE: FlowState = {
  stage: "upload",
  selectedFile: null,
  preview: null,
};

/**
 * Reducer for {@link ContentImportFlow}.
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
    case "preview_loaded":
      return { ...state, stage: "preview", preview: action.preview };
    case "reset":
      return INITIAL_FLOW_STATE;
    default:
      return state;
  }
}

/**
 * Upload form and preview for a content import. Owns both fetchers: the
 * preview fetcher posts the file (`intent=preview`), the confirm fetcher posts
 * the draft's id (`intent=confirm`) from the preview stage.
 *
 * @returns The upload form, or the preview stage once a file was parsed
 */
export function ContentImportFlow() {
  const formRef = useRef<HTMLFormElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  /** Set by "Choose a different file", so the upload stage takes focus back. */
  const refocusFileInput = useRef(false);
  const previewFetcher = useFetcherWithReset<typeof action>();
  const confirmFetcher = useFetcherWithReset<typeof action>();
  const [state, dispatch] = useReducer(flowReducer, INITIAL_FLOW_STATE);
  const { stage, selectedFile, preview } = state;
  const lastProcessedPreview = useRef<ContentImportPreview | null>(null);
  const isPreviewLoading = useDisabled(previewFetcher);

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

  const handleFileSelect = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      dispatch({ type: "file_selected", file });
      previewFetcher.reset();
      confirmFetcher.reset();
    }
  };

  const handleReset = () => {
    dispatch({ type: "reset" });
    previewFetcher.reset();
    confirmFetcher.reset();
    lastProcessedPreview.current = null;
    refocusFileInput.current = true;
    formRef.current?.reset();
  };

  return (
    <>
      <previewFetcher.Form
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
          disabled={isPreviewLoading}
        />
        <input type="hidden" name="intent" value="preview" />

        {previewFetcher.data?.error ? (
          <div className="mt-4 rounded-md border border-red-200 bg-red-50 p-4">
            <ImportErrorDetails error={previewFetcher.data.error} />
          </div>
        ) : null}

        <Button
          type="submit"
          className="my-4"
          disabled={!selectedFile || isPreviewLoading}
        >
          {isPreviewLoading ? "Checking file..." : "Preview import"}
        </Button>
      </previewFetcher.Form>

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
