/**
 * Bulk-Create Success Modal
 *
 * Pops up after a successful `/assets/new?bulk=1` submit (handled by
 * `routes/_layout+/assets.new.tsx`'s bulk branch, which returns a
 * `bulkSuccess` payload via Remix `data(...)`). The modal stays mounted
 * inside the asset form so closing it leaves the form ready for another
 * batch; the "View assets" CTA navigates to the asset index filtered by
 * the model used for the batch.
 *
 * Uses the project's `AlertDialog` primitive so behaviour (focus trap,
 * ESC + overlay click dismiss, Radix portal mount) matches the rest of
 * the app's confirm/success modals.
 *
 * @see {@link file://./form.tsx}
 * @see {@link file://./../../routes/_layout+/assets.new.tsx} bulk branch
 */
import { useState } from "react";
import { Button } from "../shared/button";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "../shared/modal";

/** Payload shape that mirrors `bulkSuccess` returned from the action. */
export type BulkCreateSuccess = {
  createdAssetIds: string[];
  assetModelId: string;
  assetModelName: string;
  /** First-N rendered titles for the preview. Computed client-side
   * before submit and re-passed to the modal so we don't need an
   * extra round-trip just to show "Dell Latitude 1, …, 2 more". */
  sampleTitles?: string[];
};

/**
 * Public wrapper. Keyed on the createdAssetIds tuple so each fresh
 * submit remounts the inner dialog with a clean `dismissed=false`
 * state — the React-recommended "reset state via key" idiom instead of
 * a sync-prop-into-state useEffect. When `success` is absent the
 * wrapper renders nothing at all.
 *
 * @param success - The action's `bulkSuccess` payload, surfaced from
 *   `useActionData`. Absent → modal stays closed.
 * @param sampleTitles - Preview titles surfaced from the form's
 *   live-preview state (the action payload omits them).
 */
export function BulkCreateSuccessModal({
  success,
  sampleTitles,
}: {
  success?: BulkCreateSuccess;
  sampleTitles?: string[];
}) {
  if (!success) return null;
  return (
    <BulkCreateSuccessDialog
      key={success.createdAssetIds.join("|")}
      success={success}
      sampleTitles={sampleTitles}
    />
  );
}

function BulkCreateSuccessDialog({
  success,
  sampleTitles,
}: {
  success: BulkCreateSuccess;
  sampleTitles?: string[];
}) {
  // Local dismissal flag — fresh per `key` change above, so the next
  // submit's payload remounts with `dismissed=false` automatically.
  const [dismissed, setDismissed] = useState(false);
  if (dismissed) return null;

  const count = success.createdAssetIds.length;
  const titles = sampleTitles ?? [];
  const head = titles.slice(0, 3);
  const remaining = Math.max(0, count - head.length);

  return (
    <AlertDialog open onOpenChange={() => setDismissed(true)}>
      <AlertDialogContent data-test-id="bulkCreateSuccessModal">
        <AlertDialogHeader>
          <AlertDialogTitle>
            Created {count} {count === 1 ? "asset" : "assets"}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {count} {count === 1 ? "asset" : "assets"} created from{" "}
            <span className="font-medium text-gray-900">
              {success.assetModelName}
            </span>
            .
          </AlertDialogDescription>
        </AlertDialogHeader>

        {head.length > 0 ? (
          <div className="rounded border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-700">
            <span className="font-mono">{head.join(", ")}</span>
            {remaining > 0 ? (
              <span className="text-gray-500"> …and {remaining} more</span>
            ) : null}
          </div>
        ) : null}

        <AlertDialogFooter>
          <Button
            type="button"
            variant="secondary"
            onClick={() => setDismissed(true)}
          >
            Close
          </Button>
          <Button
            to={`/assets?assetModel=${success.assetModelId}`}
            onClick={() => setDismissed(true)}
          >
            View assets
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
