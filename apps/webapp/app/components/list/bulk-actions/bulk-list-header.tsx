import type { ThHTMLAttributes } from "react";
import { useAtomValue, useSetAtom } from "jotai";
import { useLoaderData } from "react-router";
import {
  clearSelectedBulkItemsAtom,
  selectedBulkItemsAtom,
  selectedBulkItemsCountAtom,
  selectionIsFormStateAtom,
  setSelectedBulkItemsAtom,
} from "~/atoms/list";
import { freezeColumnClassNames } from "~/components/assets/assets-index/freeze-column-classes";
import { FakeCheckbox } from "~/components/forms/fake-checkbox";
import { PartialCheckboxIcon } from "~/components/icons/library";
import { Th } from "~/components/table";
import { useAssetIndexFreezeColumn } from "~/hooks/use-asset-index-freeze-column";
import { useAssetIndexViewState } from "~/hooks/use-asset-index-view-state";
import { isSelectingAllItems } from "~/utils/list";
import { tw } from "~/utils/tw";
import type { ListItemData } from "../list-item";

export type LoaderData = Record<string, ListItemData[]>;

type BulkListHeaderProps = ThHTMLAttributes<HTMLTableCellElement> & {
  /**
   *
   * This function is used to retrieve the items to be added in bulk-items when "Select All" is clicked.
   * It is useful when the loader data structure is different from the default one.
   * For example, the loader data on booking page is structured as:
   *
   * ```javascript
   * {
   *  paginatedItems: [
   *    { type: "kit", assets: [...] },
   *    { type: "asset", ... },
   *  ]
   * }
   * ```
   *
   * @param data Loader data containing items
   * @returns An array of ListItemData to be used in the header
   */
  itemsGetter?: (data: LoaderData) => ListItemData[];

  /**
   * The rows on screen, when they are not the loader's `items` — a list
   * rendering rows from another key (the asset index's model view) must pass
   * them, or this checkbox ticks a set nobody can see.
   */
  items?: ListItemData[];
};

/**
 * The select-page checkbox in a list's header row.
 *
 * Ticked when every row on screen is selected or "Select all" is on (outside
 * form-state screens), partial when some are, empty otherwise. Clicking it
 * clears a full selection and otherwise selects the rows on screen.
 *
 * @param props - The rows on screen (or a getter over the loader data)
 * @returns The `<th>` holding the checkbox
 */
export default function BulkListHeader({
  itemsGetter,
  items: itemsProp,
  ...rest
}: BulkListHeaderProps) {
  const loaderData = useLoaderData<Record<string, ListItemData[]>>();
  const items =
    itemsProp ??
    (typeof itemsGetter === "function"
      ? itemsGetter(loaderData)
      : loaderData.items);

  const { modeIsAdvanced } = useAssetIndexViewState();
  const freezeColumn = useAssetIndexFreezeColumn();

  const setSelectedBulkItems = useSetAtom(setSelectedBulkItemsAtom);
  const totalItemsSelected = useAtomValue(selectedBulkItemsCountAtom);
  const selectedBulkItems = useAtomValue(selectedBulkItemsAtom);
  const selectionIsFormState = useAtomValue(selectionIsFormStateAtom);

  // "Select all" ticks every row matching the filters, on every page, while
  // listing only the rows of the page it was clicked on. Under the marker the
  // header reads ticked, as the rows do (see BulkListItemCheckbox). On
  // manage-* screens the rows tick only when listed, so there the header
  // keeps the count rule below.
  const selectingAll =
    !selectionIsFormState && isSelectingAllItems(selectedBulkItems);

  const allItemsSelected = selectingAll || totalItemsSelected >= items.length;

  const partialItemsSelected = !allItemsSelected && totalItemsSelected > 0;

  const clearSelectedItems = useSetAtom(clearSelectedBulkItemsAtom);

  /** Clears a full selection, otherwise selects every row on screen. */
  function handleSelectAllIncomingItems() {
    if (allItemsSelected) {
      clearSelectedItems();
    } else {
      setSelectedBulkItems(items);
    }
  }

  return (
    <Th
      className={tw(
        "md:pl-4 md:pr-3",
        modeIsAdvanced ? "bg-gray-25" : "",
        modeIsAdvanced && freezeColumn
          ? freezeColumnClassNames.checkboxHeader
          : ""
      )}
      {...rest}
    >
      <div>
        {partialItemsSelected ? (
          <PartialCheckboxIcon
            className="cursor-pointer"
            onClick={clearSelectedItems}
          />
        ) : (
          <FakeCheckbox
            className={tw("text-white", allItemsSelected ? "text-primary" : "")}
            onClick={handleSelectAllIncomingItems}
            checked={allItemsSelected}
          />
        )}
      </div>
    </Th>
  );
}
