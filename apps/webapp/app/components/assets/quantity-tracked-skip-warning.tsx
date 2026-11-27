/**
 * The warning the asset index's bulk dialogs show for quantity-tracked assets
 * they are about to skip.
 *
 * A bulk action with no unit count per asset (update location, assign custody,
 * add to kit) cannot act on a quantity-tracked asset, so the server skips it
 * and moves the rest. The dialog says so before the user confirms.
 *
 * What the dialog knows depends on how the rows were selected. Hand-picked
 * rows are all in memory, so it can give an exact count. With "select all",
 * only the loaded page is in memory and the server expands the selection to
 * every asset the filters match, so the dialog warns in general terms and
 * gives the count it can see. Every route behind these dialogs expands
 * "select all" that way; a dialog whose route did not would have to keep the
 * exact count.
 *
 * @see {@link file://./bulk-location-update-dialog.tsx}
 * @see {@link file://./bulk-assign-custody-dialog.tsx}
 * @see {@link file://./bulk-add-to-kit-dialog.tsx}
 */
import type { ListItemData } from "~/components/list/list-item";
import { quantityTrackedSelectionMessage } from "./quantity-tracked-selection-message";
import { WarningBox } from "../shared/warning-box";

/**
 * The warning text for a selection, or `null` when it needs none.
 *
 * @param selectedItems - The selected rows, with the select-all marker when
 *   "select all" is active
 * @param instead - What to do with those assets instead, as a full sentence
 * @returns The sentence to show, or `null` when no selected row is
 *   quantity-tracked and the selection is not "select all"
 */
export function quantityTrackedSkipMessage(
  selectedItems: ListItemData[],
  instead: string
): string | null {
  return quantityTrackedSelectionMessage(
    selectedItems,
    "will be skipped",
    instead
  );
}

/**
 * Renders {@link quantityTrackedSkipMessage} in a warning box, or nothing.
 *
 * @param props.selectedItems - The selected rows
 * @param props.instead - What to do with those assets instead
 */
export function QuantityTrackedSkipWarning({
  selectedItems,
  instead,
}: {
  selectedItems: ListItemData[];
  instead: string;
}) {
  const message = quantityTrackedSkipMessage(selectedItems, instead);
  if (!message) return null;

  return (
    <div className="mb-4">
      <WarningBox>
        <span>{message}</span>
      </WarningBox>
    </div>
  );
}
