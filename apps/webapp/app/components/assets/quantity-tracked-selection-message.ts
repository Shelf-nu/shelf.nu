/**
 * How the asset index's bulk dialogs count and describe the quantity-tracked
 * assets in a selection.
 *
 * Several dialogs treat those assets differently from the rest (skip them, or
 * book them at a fixed amount) and say so before the user confirms. They all
 * count the selection here, so they cannot disagree about it.
 *
 * What a dialog can know depends on how the rows were selected. Hand-picked
 * rows are all in memory. Under "select all" only the loaded page is, and
 * whether the rest of the selection is acted on is up to the dialog's route:
 * a route that expands "select all" reaches every asset the filters match,
 * one that does not acts on nothing beyond the rows it was sent.
 * {@link quantityTrackedSelectionMessage} is for the first kind;
 * {@link countQuantityTrackedRows} alone serves the second.
 *
 * @see {@link file://./quantity-tracked-skip-warning.tsx}
 * @see {@link file://./quantity-tracked-one-unit-notice.tsx}
 */
import type { ListItemData } from "~/components/list/list-item";
import { isQuantityTracked } from "~/modules/asset/utils";
import { isSelectingAllItems } from "~/utils/list";

/**
 * The quantity-tracked rows the dialog holds in memory.
 *
 * @param selectedItems - The selected rows; the select-all marker, when
 *   present, is not a row and is never counted
 * @returns How many of them are quantity-tracked
 */
export function countQuantityTrackedRows(selectedItems: ListItemData[]) {
  return selectedItems.filter((item) => isQuantityTracked(item)).length;
}

/**
 * A sentence about the quantity-tracked assets in a selection, for a dialog
 * whose route expands "select all" to every asset the filters match.
 *
 * @param selectedItems - The selected rows, with the select-all marker when
 *   "select all" is active
 * @param outcome - What happens to those assets, as a verb phrase
 *   ("will be skipped")
 * @param then - What the user can do about it, as a full sentence
 * @returns The sentence to show, or `null` when no selected row is
 *   quantity-tracked and the selection is not "select all"
 */
export function quantityTrackedSelectionMessage(
  selectedItems: ListItemData[],
  outcome: string,
  then: string
): string | null {
  const onThisPage = countQuantityTrackedRows(selectedItems);

  if (isSelectingAllItems(selectedItems)) {
    // The rows in memory are one page of a larger selection, so their count
    // is a floor, never the total. With none in sight the selection may hold
    // none at all, so the sentence says "any".
    return onThisPage > 0
      ? `Quantity-tracked assets in your selection ${outcome} (${onThisPage} on this page, and any on others). ${then}`
      : `Any quantity-tracked assets in your selection ${outcome}. ${then}`;
  }

  if (onThisPage === 0) return null;
  return `${onThisPage} quantity-tracked asset(s) in your selection ${outcome}. ${then}`;
}
