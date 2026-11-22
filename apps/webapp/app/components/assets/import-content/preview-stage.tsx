/**
 * @file Preview stage of the content import.
 *
 * Shows what the uploaded file will create: summary counts, the records that
 * will be created on the way, and a grid of the parsed rows. The confirm
 * dialog queues the background import; the route redirects to its progress
 * page, so a successful confirm never returns to this component.
 *
 * The stage replaces the upload form, which held focus, so it moves focus to
 * its heading when it mounts. A refused confirm is read per opening of the
 * dialog, so a refusal never shows on a later opening that did not cause it.
 *
 * The preview payload carries the first page of grid rows; "Load more" reads
 * the next page of the draft from the preview rows endpoint and appends it.
 *
 * @see {@link file://./flow.tsx} Owner of the stage and the confirm fetcher
 * @see {@link file://./../import-preview/import-grid.tsx} Row grid
 * @see {@link file://./../../../routes/api+/asset-imports.$importId.preview-rows.ts} Next-page endpoint
 */
import { useMemo, useReducer, useState } from "react";
import useApiQuery from "~/hooks/use-api-query";
import { useAutoFocus } from "~/hooks/use-auto-focus";
import { useDisabled } from "~/hooks/use-disabled";
import { useFetcherOutcomeSinceOpen } from "~/hooks/use-fetcher-error-since-open";
import type useFetcherWithReset from "~/hooks/use-fetcher-with-reset";
import { formatAssetCount } from "~/modules/asset-import/format";
import type {
  ContentImportPreview,
  ContentImportPreviewRowsPage,
  ImportGridRow,
} from "~/modules/asset-import/types";
import type { action } from "~/routes/_layout+/assets.import";
import { AlertIcon } from "../../icons/library";
import { Button } from "../../shared/button";
import { ImportRowErrorsTable } from "../../shared/import-row-errors-table";
import { SummaryPill } from "../bulk-update/shared";
import { ConfirmImportDialog } from "../import-preview/confirm-import-dialog";
import { ImportErrorDetails } from "../import-preview/import-error-details";
import { ImportGrid } from "../import-preview/import-grid";
import { NewEntitiesNotice } from "../import-preview/new-entities-notice";

/** The slice of the confirm fetcher the stage uses. */
type ConfirmFetcher = Pick<
  ReturnType<typeof useFetcherWithReset<typeof action>>,
  "state" | "data" | "submit" | "reset"
>;

/** What the preview rows endpoint answers: a page, or an error payload. */
type PreviewRowsResponse =
  | (ContentImportPreviewRowsPage & { error: null })
  | { error: { message: string } };

/**
 * Rows loaded with "Load more", beyond the first page in the preview payload.
 * Tagged with the draft they belong to, so a different preview never shows
 * another file's rows.
 */
type MoreRowsState = {
  importId: string | null;
  rows: ImportGridRow[];
  /** Offset of the page being loaded, or `null` when nothing is loading. */
  requestedOffset: number | null;
  error: string | null;
};

/** Transitions of {@link MoreRowsState}. */
type MoreRowsAction =
  | { type: "request"; importId: string; offset: number }
  | { type: "loaded"; importId: string; rows: ImportGridRow[] }
  | { type: "failed"; importId: string; message: string };

const NO_MORE_ROWS: MoreRowsState = {
  importId: null,
  rows: [],
  requestedOffset: null,
  error: null,
};

/**
 * Reducer for the rows loaded with "Load more".
 *
 * @param state - Current state
 * @param action - The transition to apply
 * @returns The next state
 */
function moreRowsReducer(
  state: MoreRowsState,
  action: MoreRowsAction
): MoreRowsState {
  // Rows of another draft are dropped: a page belongs to one import only.
  const current =
    state.importId === action.importId
      ? state
      : { ...NO_MORE_ROWS, importId: action.importId };
  switch (action.type) {
    case "request":
      return { ...current, requestedOffset: action.offset, error: null };
    case "loaded":
      return {
        ...current,
        rows: [...current.rows, ...action.rows],
        requestedOffset: null,
      };
    case "failed":
      return { ...current, requestedOffset: null, error: action.message };
    default:
      return state;
  }
}

/** Props for {@link PreviewStage}. */
type PreviewStageProps = {
  /** Server preview of the uploaded file. */
  preview: ContentImportPreview;
  /** Returns to the upload stage so another file can be chosen. */
  onReset: () => void;
  /** Posts `intent=confirm` with the draft's `importId`. */
  confirmFetcher: ConfirmFetcher;
};

/**
 * Renders the preview of a validated, not yet imported file. It mounts when
 * the preview loads, which is when it takes focus.
 *
 * @param props - See {@link PreviewStageProps}
 * @returns Summary, notices, row grid and the confirm controls
 */
export function PreviewStage({
  preview,
  onReset,
  confirmFetcher,
}: PreviewStageProps) {
  const isConfirming = useDisabled(confirmFetcher);
  const { counts, newEntities, totalRows, valueWarnings, totalValueWarnings } =
    preview;
  const [dialogOpen, setDialogOpen] = useState(false);
  const confirmOutcome = useFetcherOutcomeSinceOpen(confirmFetcher, dialogOpen);
  // The refusal shown in the dialog: the confirm fetcher's error, but only when
  // it answered the opening in front of the user.
  const confirmError =
    confirmOutcome.status === "rejected" ? confirmFetcher.data?.error : null;
  // The heading is rendered in place (no portal), so it can be focused in the
  // mount effect without waiting a frame.
  const headingRef = useAutoFocus<HTMLHeadingElement>({
    deferToNextFrame: false,
  });

  const { importId } = preview;
  const [moreRowsState, dispatchMoreRows] = useReducer(
    moreRowsReducer,
    NO_MORE_ROWS
  );
  const moreRows =
    moreRowsState.importId === importId ? moreRowsState : NO_MORE_ROWS;
  const rows = useMemo(
    () => [...preview.rows, ...moreRows.rows],
    [preview.rows, moreRows.rows]
  );
  const { requestedOffset } = moreRows;
  const hasNewCells = rows.some((row) =>
    Object.values(row.cells).some((cell) => cell.tone === "new")
  );

  useApiQuery<PreviewRowsResponse>({
    api: `/api/asset-imports/${importId}/preview-rows`,
    searchParams:
      requestedOffset === null
        ? undefined
        : new URLSearchParams({ offset: String(requestedOffset) }),
    enabled: requestedOffset !== null,
    onSuccess: (response) => {
      if (response.error) {
        dispatchMoreRows({
          type: "failed",
          importId,
          message: response.error.message,
        });
        return;
      }
      dispatchMoreRows({ type: "loaded", importId, rows: response.rows });
    },
    // A network or parse failure carries no message worth showing.
    onError: () =>
      dispatchMoreRows({
        type: "failed",
        importId,
        message: "Something went wrong. Please try again.",
      }),
  });

  return (
    <div className="mt-4 w-full">
      <h4 ref={headingRef} tabIndex={-1} className="mb-2">
        {preview.fileName ? `Preview of ${preview.fileName}` : "Import preview"}
      </h4>
      <div className="mb-4 flex flex-wrap items-center gap-2 text-sm">
        <SummaryPill count={totalRows} label="assets" color="blue" />
        <SummaryPill
          count={counts.withImage}
          label="with images"
          color="gray"
        />
        <SummaryPill
          count={counts.withCustodian}
          label="with custodian"
          color="gray"
        />
        <SummaryPill count={counts.inKit} label="in kits" color="gray" />
      </div>

      <NewEntitiesNotice
        entities={[
          { label: "New categories", names: newEntities.categories },
          { label: "New locations", names: newEntities.locations },
          { label: "New tags", names: newEntities.tags },
          { label: "New kits", names: newEntities.kits },
          { label: "New custodians", names: newEntities.custodians },
          { label: "New custom fields", names: newEntities.customFields },
          { label: "New asset models", names: newEntities.assetModels },
        ]}
      />

      {totalValueWarnings > 0 ? (
        <div className="mb-4 rounded-md border border-amber-200 bg-amber-50 p-4">
          <p className="mb-2 font-medium text-amber-800">
            <AlertIcon className="inline-block size-4" /> {totalValueWarnings}{" "}
            barcode {totalValueWarnings === 1 ? "value" : "values"} may not
            match {totalValueWarnings === 1 ? "its label" : "their labels"}
          </p>
          <p className="text-sm text-amber-700">
            Scanning matches the exact text a QR code encodes. You can import
            anyway, or fix the file and upload it again.
          </p>
          <ImportRowErrorsTable
            rowErrors={valueWarnings}
            totalRowErrors={totalValueWarnings}
            tone="warning"
          />
        </div>
      ) : null}

      <ImportGrid
        columns={preview.columns}
        rows={rows}
        totalRows={totalRows}
        onLoadMore={() =>
          dispatchMoreRows({ type: "request", importId, offset: rows.length })
        }
        isLoadingMore={requestedOffset !== null}
        caption={`${formatAssetCount(totalRows)} will be created`}
        legend={[
          ...(hasNewCells
            ? [
                {
                  tone: "new" as const,
                  label: "New: will be created on import",
                },
              ]
            : []),
          ...(totalValueWarnings > 0
            ? [{ tone: "warning" as const, label: "Check this value" }]
            : []),
        ]}
        ariaLabel="Import preview"
      />
      {moreRows.error ? (
        <p role="alert" className="-mt-2 mb-4 text-sm text-error-600">
          Could not load more rows: {moreRows.error}
        </p>
      ) : null}

      <div className="my-4 flex flex-wrap items-center gap-3">
        <ConfirmImportDialog
          triggerLabel={`Import ${formatAssetCount(totalRows)}`}
          title="Confirm asset import"
          description="The import runs in the background. You can leave this page; we will email you when it finishes."
          confirmLabel={isConfirming ? "Starting..." : "Import"}
          isSubmitting={isConfirming}
          errorDetails={
            confirmError ? <ImportErrorDetails error={confirmError} /> : null
          }
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          onClose={() => confirmFetcher.reset()}
          onConfirm={() => {
            void confirmFetcher.submit(
              { intent: "confirm", importId: preview.importId },
              { method: "post" }
            );
          }}
        />
        <Button type="button" variant="secondary" onClick={onReset}>
          Choose a different file
        </Button>
      </div>
    </div>
  );
}
