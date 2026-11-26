/**
 * The notice the asset index's booking dialogs show for quantity-tracked
 * assets in the selection.
 *
 * "Create booking" and "Add to existing booking" send asset ids only, with no
 * unit count, so each quantity-tracked asset is booked at 1 unit. The dialog
 * says so before the user confirms, and where the amount can be changed.
 *
 * The count follows {@link quantityTrackedSelectionMessage}: exact for
 * hand-picked rows, a floor under "select all", where only the loaded page is
 * in memory.
 *
 * @see {@link file://./assets-index/create-booking-for-selected-assets-dialog.tsx}
 * @see {@link file://./assets-index/add-assets-to-existing-booking-dialog.tsx}
 * @see {@link file://./quantity-tracked-skip-warning.tsx}
 */
import type { ListItemData } from "~/components/list/list-item";
import { quantityTrackedSelectionMessage } from "./quantity-tracked-skip-warning";
import { WarningBox } from "../shared/warning-box";

/** Where the booked amount of a quantity-tracked asset is changed afterwards. */
const CHANGE_ON_BOOKING = "You can change the amount on the booking.";

/**
 * The notice text for a selection, or `null` when it needs none.
 *
 * @param selectedItems - The selected rows, with the select-all marker when
 *   "select all" is active
 * @returns The sentence to show, or `null` when no selected row is
 *   quantity-tracked and the selection is not "select all"
 */
export function quantityTrackedOneUnitMessage(
  selectedItems: ListItemData[]
): string | null {
  return quantityTrackedSelectionMessage(
    selectedItems,
    "will be booked at 1 unit each",
    CHANGE_ON_BOOKING
  );
}

/**
 * Renders {@link quantityTrackedOneUnitMessage} in a warning box, or nothing.
 *
 * @param props.selectedItems - The selected rows
 */
export function QuantityTrackedOneUnitNotice({
  selectedItems,
}: {
  selectedItems: ListItemData[];
}) {
  const message = quantityTrackedOneUnitMessage(selectedItems);
  if (!message) return null;

  return (
    <div className="mb-4">
      <WarningBox>
        <span>{message}</span>
      </WarningBox>
    </div>
  );
}
