/**
 * @file The two-step asset import form of `/assets/import`.
 *
 * Step 1: the user picks a CSV and presses Continue; the file is posted with
 * the `analyze` intent and comes back as a proposed column mapping.
 * Step 2: the user reviews the mapping in {@link MappingReview}, then confirms
 * the "I AGREE" dialog, which posts the same file with the `content` intent
 * and the reviewed mapping as JSON.
 *
 * The file input stays mounted through both steps (hidden while reviewing), so
 * the same File object is posted again. Picking another file starts over. The
 * review section sits outside the form, so no input in it can submit the
 * analyze step by pressing Enter.
 *
 * @see {@link file://./../../../routes/_layout+/assets.import.tsx} the action
 * @see {@link file://./mapping-review.tsx} the review table
 */
import type { ChangeEvent } from "react";
import { useEffect, useMemo, useReducer, useRef } from "react";
import { useDisabled } from "~/hooks/use-disabled";
import useFetcherWithReset from "~/hooks/use-fetcher-with-reset";
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
import { tw } from "~/utils/tw";
import Input from "../../forms/input";
import { Button } from "../../shared/button";
import { ImportConfirmDialog } from "../import-content";
import { MappingReview, existingTypeFor } from "./mapping-review";

/** What the `analyze` intent returns. */
export type MappingAnalysis = {
  proposal: MappingProposal;
  rowCount: number;
  alreadyMatches: boolean;
  columnStats: ColumnStats[];
  existingCustomFields: ExistingCustomField[];
};

type State =
  | { stage: "pick" }
  | {
      stage: "review";
      analysis: MappingAnalysis;
      columns: ColumnMapping[];
    };

type Action =
  | { type: "start_over" }
  | { type: "analysis_loaded"; analysis: MappingAnalysis }
  | { type: "target_changed"; index: number; target: ColumnTarget };

/**
 * The form's state machine. A column the user edits counts as sure, and a
 * custom field named like an existing one takes that field's stored type,
 * because the importer refuses any other.
 */
function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "start_over":
      return { stage: "pick" };
    case "analysis_loaded":
      return {
        stage: "review",
        analysis: action.analysis,
        columns: action.analysis.proposal.columns,
      };
    case "target_changed": {
      if (state.stage !== "review") return state;
      let target = action.target;
      if (target.kind === "customField") {
        const existingType = existingTypeFor(
          state.analysis.existingCustomFields,
          target.name
        );
        if (existingType) target = { ...target, type: existingType };
      }
      const columns = state.columns.map((column, index) =>
        index === action.index
          ? { ...column, target, confidence: "high" as const }
          : column
      );
      return { ...state, columns };
    }
  }
}

/** Stable empty list for the file step, so memoised reads keep their identity. */
const NO_COLUMNS: ColumnMapping[] = [];

/**
 * Reads an `analyze` response, which shares the route's payload union with
 * the `content` response.
 *
 * @returns The analysis, or `null` for any other response
 */
function readAnalysis(data: unknown): MappingAnalysis | null {
  if (!data || typeof data !== "object") return null;
  if ("error" in data && data.error) return null;
  return "proposal" in data ? (data as MappingAnalysis) : null;
}

/**
 * The asset import form with its mapping review step.
 */
export function MappingImportForm() {
  const { canUseBarcodes } = useBarcodePermissions();
  const formRef = useRef<HTMLFormElement>(null);
  const analyzeFetcher = useFetcherWithReset<typeof action>();
  const contentFetcher = useFetcherWithReset<typeof action>();
  const isAnalyzing = useDisabled(analyzeFetcher);
  const [state, dispatch] = useReducer(reducer, { stage: "pick" });
  const fileNameRef = useRef<string>("");
  const lastAnalysis = useRef<MappingAnalysis | null>(null);

  const analysis = readAnalysis(analyzeFetcher.data);
  useEffect(() => {
    if (analysis && analysis !== lastAnalysis.current) {
      lastAnalysis.current = analysis;
      dispatch({ type: "analysis_loaded", analysis });
    }
  }, [analysis]);

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    fileNameRef.current = event.target.files?.[0]?.name ?? "";
    lastAnalysis.current = null;
    analyzeFetcher.reset();
    contentFetcher.reset();
    dispatch({ type: "start_over" });
  };

  const columns = state.stage === "review" ? state.columns : NO_COLUMNS;
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

  const submitImport = () => {
    if (state.stage !== "review" || !formRef.current) return;
    const original = state.analysis.proposal.columns;
    const changed = state.columns.filter(
      (column, index) =>
        JSON.stringify(column.target) !==
        JSON.stringify(original[index]?.target)
    ).length;

    const formData = new FormData(formRef.current);
    formData.set("intent", "content");
    formData.set("mapping", JSON.stringify(state.columns));
    formData.set("mappingChanged", String(changed));
    void contentFetcher.submit(formData, {
      method: "post",
      encType: "multipart/form-data",
    });
  };

  const analyzeError = analyzeFetcher.data?.error;

  return (
    <div className="mt-4 w-full">
      <analyzeFetcher.Form
        className="w-full"
        method="post"
        ref={formRef}
        encType="multipart/form-data"
      >
        {/* Hidden, not unmounted, while reviewing: the File is posted again. */}
        <div className={tw(state.stage === "review" && "hidden")}>
          <Input
            type="file"
            name="file"
            label="Select a csv file"
            required
            onChange={handleFileChange}
            accept=".csv"
          />
          <input type="hidden" name="intent" value="analyze" />
          <Button type="submit" disabled={isAnalyzing} className="my-4">
            {isAnalyzing ? "Reading your file..." : "Continue"}
          </Button>
          {analyzeError ? (
            <div
              role="alert"
              className="rounded-md border border-error-200 bg-error-25 p-4 text-[14px] text-error-700"
            >
              <p className="font-semibold">{analyzeError.title}</p>
              <p>{analyzeError.message}</p>
            </div>
          ) : null}
        </div>
      </analyzeFetcher.Form>

      {/* Outside the form on purpose: Enter in any review input must never
          submit the analyze form, which would re-run it and drop every edit. */}
      {state.stage === "review" ? (
        <section aria-labelledby="mapping-review-title">
          <h4 id="mapping-review-title">Check how your columns map</h4>
          <p className="text-[14px] text-gray-600">
            {fileNameRef.current ? <b>{fileNameRef.current}</b> : "Your file"}:
            each column goes to the Shelf field on its right. Change any that
            look wrong, or set them to Skip.
          </p>

          <MappingReview
            columns={state.columns}
            onChange={(index, target) =>
              dispatch({ type: "target_changed", index, target })
            }
            duplicateRows={duplicateRows}
            existingCustomFields={state.analysis.existingCustomFields}
            canUseBarcodes={canUseBarcodes}
            // Recomputed from the edited mapping, so a note goes away once the
            // column it warns about is remapped.
            notes={buildFormatNotes(state.columns)}
            alreadyMatches={isAlreadyShelfFormat(state.columns)}
            summary={summarizeMapping({
              columns: state.columns,
              stats: state.analysis.columnStats,
              rowCount: state.analysis.rowCount,
              existingCustomFieldNames: state.analysis.existingCustomFields.map(
                ({ name }) => name
              ),
            })}
          />

          {duplicateRows.size > 0 ? (
            <p role="alert" className="mt-2 text-[14px] text-error-600">
              Two or more columns go to the same Shelf field. Fix the rows
              marked above to continue.
            </p>
          ) : null}

          <div className="flex gap-3">
            <Button
              type="button"
              variant="secondary"
              className="my-4"
              onClick={() => {
                lastAnalysis.current = analysis;
                contentFetcher.reset();
                dispatch({ type: "start_over" });
              }}
            >
              Back
            </Button>
            <ImportConfirmDialog
              fetcher={contentFetcher}
              triggerLabel="Import"
              triggerDisabled={
                duplicateRows.size > 0 || hasInvalidName || allSkipped
              }
              onSubmit={submitImport}
            />
          </div>
        </section>
      ) : null}
    </div>
  );
}
