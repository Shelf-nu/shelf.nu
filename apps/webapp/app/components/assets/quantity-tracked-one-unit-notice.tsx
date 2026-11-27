/**
 * The notice the asset index's booking dialogs show for quantity-tracked
 * assets in the selection.
 *
 * "Create booking" and "Add to existing booking" send asset ids only, with no
 * unit count, so each quantity-tracked asset is booked at 1 unit. The dialog
 * says so before the user confirms, and where the amount can be changed.
 *
 * The count is always the exact number of quantity-tracked rows the dialog
 * holds. Neither booking route expands "select all", so nothing beyond the
 * rows it is sent is booked, and the notice never speaks for assets on other
 * pages.
 *
 * @see {@link file://./assets-index/create-booking-for-selected-assets-dialog.tsx}
 * @see {@link file://./assets-index/add-assets-to-existing-booking-dialog.tsx}
 * @see {@link file://./quantity-tracked-selection-message.ts}
 */
import type { ListItemData } from "~/components/list/list-item";
import { countQuantityTrackedRows } from "./quantity-tracked-selection-message";
import { WarningBox } from "../shared/warning-box";

/**
 * The notice text for a selection, or `null` when it needs none.
 *
 * @param selectedItems - The selected rows
 * @param excludeIds - Ids of selected assets that will not be booked (already
 *   on the chosen booking); they are left out of the count
 * @returns The sentence to show, or `null` when no quantity-tracked asset is
 *   about to be booked
 */
export function quantityTrackedOneUnitMessage(
  selectedItems: ListItemData[],
  excludeIds: string[] = []
): string | null {
  const count = countQuantityTrackedRows(
    selectedItems.filter((item) => !excludeIds.includes(item.id))
  );
  if (count === 0) return null;
  return `${count} quantity-tracked asset(s) in your selection will be booked at 1 unit each. You can change the amount on the booking.`;
}

/**
 * Renders {@link quantityTrackedOneUnitMessage} in a warning box, or nothing.
 *
 * @param props.selectedItems - The selected rows
 * @param props.excludeIds - Ids of selected assets that will not be booked
 */
export function QuantityTrackedOneUnitNotice({
  selectedItems,
  excludeIds,
}: {
  selectedItems: ListItemData[];
  excludeIds?: string[];
}) {
  const message = quantityTrackedOneUnitMessage(selectedItems, excludeIds);
  if (!message) return null;

  return (
    <div className="mb-4">
      <WarningBox>
        <span>{message}</span>
      </WarningBox>
    </div>
  );
}
