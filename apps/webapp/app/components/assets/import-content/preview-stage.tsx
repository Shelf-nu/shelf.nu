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
 * @see {@link file://./flow.tsx} Owner of the stage and the confirm fetcher
 * @see {@link file://./../import-preview/import-grid.tsx} Row grid
 */
import { useState } from "react";
import { useAutoFocus } from "~/hooks/use-auto-focus";
import { useDisabled } from "~/hooks/use-disabled";
import { useFetcherOutcomeSinceOpen } from "~/hooks/use-fetcher-error-since-open";
import type useFetcherWithReset from "~/hooks/use-fetcher-with-reset";
import type { ContentImportPreview } from "~/modules/asset-import/types";
import type { action } from "~/routes/_layout+/assets.import";
import { Button } from "../../shared/button";
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
  const { counts, newEntities, totalRows } = preview;
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

      <ImportGrid
        columns={preview.columns}
        rows={preview.rows}
        totalRows={totalRows}
        caption={`${totalRows} assets will be created`}
        legend={[{ tone: "new", label: "Will be created" }]}
        ariaLabel="Import preview"
      />

      <div className="my-4 flex flex-wrap items-center gap-3">
        <ConfirmImportDialog
          triggerLabel={`Import ${totalRows} assets`}
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
