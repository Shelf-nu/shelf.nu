/**
 * Delete Confirmation (server guard)
 *
 * The server half of the typed confirmation: {@link assertBulkDeleteConfirmed}
 * for bulk deletes and {@link assertDeleteConfirmed} for single ones. The web
 * routes call them before deleting, so a request that skipped the dialog, or a
 * tab opened before the dialog asked for a name, is refused.
 *
 * @see {@link file://../components/bulk-update-dialog/bulk-delete-confirmation.tsx}
 */
import { deleteConfirmationMatches } from "@shelf/labels";
import { EXPECTED_CONFIRMATION_KEY } from "./delete-confirmation";
import type { ErrorLabel } from "./error";
import { ShelfError } from "./error";
import { ALL_SELECTED_KEY } from "./list";

/** How a bulk delete names what it removes, e.g. `{ one: "kit", many: "kits" }`. */
type BulkDeleteNoun = { one: string; many: string };

/**
 * Refuses a bulk delete whose typed confirmation is not the number of items it
 * would remove.
 *
 * Every bulk delete dialog asks the user to type how many items they selected.
 * This is the server half of that rule, so a scripted request, or a tab opened
 * before the dialog asked for a number, cannot skip it.
 *
 * - **Select all** (`selectedIds` holds {@link ALL_SELECTED_KEY}): the server
 *   resolves the selection from the filters, so it must also be the one to
 *   count it. `matchedCount` is that count, taken from the rows the caller is
 *   about to delete. A list that grew since the dialog opened, or a stale tab,
 *   is refused with the real number; the user is never committed to more than
 *   they typed.
 * - **Explicit ids**: the dialog showed the number of ids it posted, so that is
 *   the number expected.
 *
 * Call it after the selection is resolved and before the first write.
 *
 * @param params.selectedIds - The ids as posted, possibly with ALL_SELECTED_KEY
 * @param params.confirmation - What the user typed, from the `confirmation` field
 * @param params.matchedCount - How many rows the delete resolved to
 * @param params.noun - How the items are named in the refusal
 * @param params.label - The calling module's error label
 * @throws {ShelfError} 400 when the confirmation is missing or does not match;
 *   `additionalData[EXPECTED_CONFIRMATION_KEY]` holds the number to type
 */
export function assertBulkDeleteConfirmed({
  selectedIds,
  confirmation,
  matchedCount,
  noun,
  label,
}: {
  selectedIds: string[];
  confirmation: string | null | undefined;
  matchedCount: number;
  noun: BulkDeleteNoun;
  label: ErrorLabel;
}) {
  const selectAll = selectedIds.includes(ALL_SELECTED_KEY);
  const expected = selectAll ? matchedCount : selectedIds.length;

  if (deleteConfirmationMatches(confirmation, expected)) {
    return;
  }

  const name = expected === 1 ? noun.one : noun.many;
  const typed = confirmation?.trim();

  throw new ShelfError({
    cause: null,
    title: "Nothing was deleted",
    message:
      selectAll && typed
        ? `Nothing was deleted. Your selection matches ${expected} ${name}, not ${typed}. Type ${expected} to delete them.`
        : `Nothing was deleted. Type the number of selected ${noun.many} (${expected}) to confirm.`,
    additionalData: { [EXPECTED_CONFIRMATION_KEY]: expected, selectAll },
    label,
    status: 400,
    shouldBeCaptured: false,
  });
}

/**
 * Refuses a single delete whose typed confirmation is not the item's name.
 *
 * Called by the web delete routes with the item's current name (an account's
 * email for the admin user delete). The mobile delete endpoints do not call
 * it: installed phone apps that predate the typed sheet post no confirmation.
 *
 * @param params.confirmation - What the user typed, from the `confirmation` field
 * @param params.expected - The item's current name, as the dialog showed it
 * @param params.label - The calling route's error label
 * @throws {ShelfError} 400 when the confirmation is missing or does not match
 */
export function assertDeleteConfirmed({
  confirmation,
  expected,
  label,
}: {
  confirmation: string | null | undefined;
  expected: string;
  label: ErrorLabel;
}) {
  if (deleteConfirmationMatches(confirmation, expected)) {
    return;
  }

  throw new ShelfError({
    cause: null,
    title: "Nothing was deleted",
    message: `Nothing was deleted. Type "${expected}" to confirm.`,
    label,
    status: 400,
    shouldBeCaptured: false,
  });
}
