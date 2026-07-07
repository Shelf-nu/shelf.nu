import type { MouseEvent } from "react";
import { useAtomValue, useSetAtom } from "jotai";
import {
  bulkSelectionKey,
  disabledBulkItemsAtom,
  removeSelectedBulkItemsAtom,
  selectedBulkItemsAtom,
  setSelectedBulkItemAtom,
  setSelectedBulkItemsAtom,
} from "~/atoms/list";
import { freezeColumnClassNames } from "~/components/assets/assets-index/freeze-column-classes";
import { FakeCheckbox } from "~/components/forms/fake-checkbox";
import { Td } from "~/components/table";
import { useAssetIndexFreezeColumn } from "~/hooks/use-asset-index-freeze-column";
import { useAssetIndexViewState } from "~/hooks/use-asset-index-view-state";
import { tw } from "~/utils/tw";
import type { ListItemData } from "../list-item";

type BulkListItemCheckboxProps = {
  item: ListItemData;
  /**
   * In booking list, we have list and kit in single table.
   * To select a kit, we need to select all items in the kit.
   */
  bulkItems?: ListItemData[];
  className?: string;
};

export default function BulkListItemCheckbox({
  item,
  bulkItems,
  className,
}: BulkListItemCheckboxProps) {
  const selectedBulkItems = useAtomValue(selectedBulkItemsAtom);
  const disabledBulkItems = useAtomValue(disabledBulkItemsAtom);
  const setSelectedBulkItem = useSetAtom(setSelectedBulkItemAtom);
  const setSelectedBulkItems = useSetAtom(setSelectedBulkItemsAtom);
  const removeSelectedBulkItems = useSetAtom(removeSelectedBulkItemsAtom);

  const freezeColumn = useAssetIndexFreezeColumn();
  const { modeIsAdvanced } = useAssetIndexViewState();

  // Compare by `bulkSelectionKey` (= `bookingAssetId ?? id`) so a kit-driven
  // slice and a standalone slice of the same asset are tracked independently.
  // See helper JSDoc in ~/atoms/list for the multi-slice rationale.
  const itemKey = bulkSelectionKey(item);
  const disabled = disabledBulkItems.some(
    (i) => bulkSelectionKey(i) === itemKey
  );
  const checked = !!selectedBulkItems.find(
    (i) => bulkSelectionKey(i) === itemKey
  );

  function handleBulkItemSelection(e: MouseEvent<HTMLTableCellElement>) {
    e.preventDefault();
    e.stopPropagation();
    if (disabled) return;

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
