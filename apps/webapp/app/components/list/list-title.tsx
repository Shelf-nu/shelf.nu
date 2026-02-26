import { useAtomValue, useSetAtom } from "jotai";
import { X } from "lucide-react";
import { useLoaderData } from "react-router";
import {
  clearSelectedBulkItemsAtom,
  selectedBulkItemsAtom,
  selectedBulkItemsCountAtom,
  setSelectedBulkItemsAtom,
} from "~/atoms/list";
import { ALL_SELECTED_KEY, isSelectingAllItems } from "~/utils/list";
import { tw } from "~/utils/tw";
import type { IndexResponse } from ".";
import type { ListItemData } from "./list-item";
import { Button } from "../shared/button";
import type { LoaderData } from "./bulk-actions/bulk-list-header";

type ListTitleProps = {
  title?: string;
  hasBulkActions: boolean;
  disableSelectAllItems?: boolean;
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
   * Optional class name for the title element
   */
  titleClassName?: string;
};

export default function ListTitle({
  title,
  hasBulkActions,
  disableSelectAllItems = false,
  itemsGetter,
  titleClassName,
}: ListTitleProps) {
  const loaderData = useLoaderData<LoaderData>();
  const {
    totalItems,
    perPage,
    modelName: { singular, plural },
  } = loaderData as unknown as IndexResponse;

  const items =
    typeof itemsGetter === "function"
      ? itemsGetter(loaderData)
      : loaderData.items;

  const setSelectedBulkItems = useSetAtom(setSelectedBulkItemsAtom);
  const selectedBulkItemsCount = useAtomValue(selectedBulkItemsCountAtom);
  const selectedBulkItems = useAtomValue(selectedBulkItemsAtom);
  const hasSelectedAllItems = isSelectingAllItems(selectedBulkItems);
  const clearSelectedItems = useSetAtom(clearSelectedBulkItemsAtom);
  const hasSelectedItems = selectedBulkItemsCount > 0;

  /**
   * We can select all the incoming items and we can add ALL_SELECTED_KEY
   * in the selected items. We check in backend for this ALL_SELECTED_KEY, if it is selected
   * then we do operation on all items of organization
   */
  function handleSelectAllItems() {
    setSelectedBulkItems([...items, { id: ALL_SELECTED_KEY }]);
  }

  return (
    <div>
      <div
        className={tw(
          "text-left text-text-sm font-semibold capitalize text-gray-900",
          titleClassName
        )}
      >
        {title || plural}
      </div>
      <div className="h-7">
        {hasBulkActions && hasSelectedItems ? (
          <div className="flex items-start gap-2">
            <Button
              onClick={clearSelectedItems}
              variant="secondary"
              className="p-[2px] text-[14px]"
              aria-label="Clear selected items"
            >
              <X size={12} strokeWidth={3} className="text-gray-600" />
            </Button>
            {hasSelectedAllItems ? totalItems : selectedBulkItemsCount} selected
            {!disableSelectAllItems &&
              !hasSelectedAllItems &&
              selectedBulkItemsCount < totalItems && (
                <Button onClick={handleSelectAllItems} variant="block-link">
                  Select all {totalItems} entries
                </Button>
              )}
          </div>
        ) : (
          <div>
            {perPage < totalItems ? (
              <p>
                {items.length} {items.length > 1 ? plural : singular}{" "}
                <span className="text-color-400">out of {totalItems}</span>
              </p>
            ) : (
              <span>
                {totalItems} {items.length > 1 ? plural : singular}
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
