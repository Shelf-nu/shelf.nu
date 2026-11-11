import type { MouseEvent } from "react";
import { useAtomValue, useSetAtom } from "jotai";
import {
  bulkSelectionKey,
  disabledBulkItemsAtom,
  removeSelectedBulkItemsAtom,
  selectedBulkItemsAtom,
  selectionIsFormStateAtom,
  setSelectedBulkItemAtom,
  setSelectedBulkItemsAtom,
} from "~/atoms/list";
import { showNotificationAtom } from "~/atoms/notifications";
import { freezeColumnClassNames } from "~/components/assets/assets-index/freeze-column-classes";
import { FakeCheckbox } from "~/components/forms/fake-checkbox";
import { Td } from "~/components/table";
import { useAssetIndexFreezeColumn } from "~/hooks/use-asset-index-freeze-column";
import { useAssetIndexViewState } from "~/hooks/use-asset-index-view-state";
import { ALL_SELECTED_KEY, isSelectingAllItems } from "~/utils/list";
import { tw } from "~/utils/tw";
import type { ListItemData } from "../list-item";

type BulkListItemCheckboxProps = {
  item: ListItemData;
  /**
   * In booking list, we have list and kit in single table.
   * To select a kit, we need to select all items in the kit.
   */
  bulkItems?: ListItemData[];
  /**
   * Every row on the page this checkbox sits on. Required for the row to
   * follow "Select all": unticking one row then keeps the rest of these
   * ticked. Lists that do not pass it tick only the rows they listed.
   */
  pageItems?: ListItemData[];
  className?: string;
};

export default function BulkListItemCheckbox({
  item,
  bulkItems,
  pageItems,
  className,
}: BulkListItemCheckboxProps) {
  const selectedBulkItems = useAtomValue(selectedBulkItemsAtom);
  const disabledBulkItems = useAtomValue(disabledBulkItemsAtom);
  const setSelectedBulkItem = useSetAtom(setSelectedBulkItemAtom);
  const setSelectedBulkItems = useSetAtom(setSelectedBulkItemsAtom);
  const removeSelectedBulkItems = useSetAtom(removeSelectedBulkItemsAtom);
  const replaceSelectedBulkItems = useSetAtom(selectedBulkItemsAtom);
  const showNotification = useSetAtom(showNotificationAtom);
  // On manage-* screens the selection is what gets saved: every attached item
  // left out of it is detached. There a row ticks only when listed, so no
  // click here can drop attached items that sit on other pages.
  const selectionIsFormState = useAtomValue(selectionIsFormStateAtom);

  const freezeColumn = useAssetIndexFreezeColumn();
  const { modeIsAdvanced } = useAssetIndexViewState();

  // Compare by `bulkSelectionKey` (= `bookingAssetId ?? id`) so a kit-driven
  // slice and a standalone slice of the same asset are tracked independently.
  // See helper JSDoc in ~/atoms/list for the multi-slice rationale.
  const itemKey = bulkSelectionKey(item);
  const disabled = disabledBulkItems.some(
    (i) => bulkSelectionKey(i) === itemKey
  );
  // "Select all" stores ALL_SELECTED_KEY, not the ids of rows on other pages,
  // and the server acts on every row matching the list's filters. So with the
  // key present every selectable row is ticked, listed or not.
  const selectingAll =
    !!pageItems &&
    !selectionIsFormState &&
    isSelectingAllItems(selectedBulkItems);
  const listed = selectedBulkItems.some((i) => bulkSelectionKey(i) === itemKey);
  const checked = listed || (selectingAll && !disabled);

  function handleBulkItemSelection(e: MouseEvent<HTMLTableCellElement>) {
    e.preventDefault();
    e.stopPropagation();
    if (disabled) return;

    if (selectingAll && pageItems) {
      // The selection cannot say "every match except this row", so unticking
      // a row leaves "Select all" and keeps what the reader sees ticked: this
      // page, minus the row (and, for a kit row, its assets). The toast says
      // so, because the next bulk action now reaches this page only.
      const leftOutKeys = new Set([
        ...[item, ...(bulkItems ?? [])].map(bulkSelectionKey),
        ...disabledBulkItems.map(bulkSelectionKey),
      ]);
      const stillTicked = pageItems.filter(
        (i) =>
          i.id !== ALL_SELECTED_KEY && !leftOutKeys.has(bulkSelectionKey(i))
      );
      replaceSelectedBulkItems(stillTicked);
      showNotification({
        title: "Select all is off",
        message: `Only the ${stillTicked.length} ticked rows on this page are selected now.`,
        icon: { name: "check", variant: "gray" },
        senderId: null,
      });
      return;
    }

    if (bulkItems && bulkItems.length > 0) {
      const itemsToSet = [...bulkItems, item];
      const itemsToSetKeys = new Set(itemsToSet.map(bulkSelectionKey));
      const itemsExists = selectedBulkItems.some((selItem) =>
        itemsToSetKeys.has(bulkSelectionKey(selItem))
      );

      /** If the selected items already exists, then remove them */
      if (itemsExists) {
        removeSelectedBulkItems(itemsToSet);
      } else {
        setSelectedBulkItems(itemsToSet);
      }
    } else {
      setSelectedBulkItem(item);
    }
  }

  return (
    <Td
      className={tw(
        "md:pl-4 md:pr-3",
        modeIsAdvanced && freezeColumn ? freezeColumnClassNames.checkbox : "",
        disabled ? "cursor-not-allowed" : "",
        className
      )}
      onClick={handleBulkItemSelection}
    >
      <div>
        <FakeCheckbox
          className={tw(
            "overflow-visible text-white",
            checked ? "text-primary" : "",
            disabled ? "text-gray-200" : ""
          )}
          checked={checked}
        />
      </div>
    </Td>
  );
}
