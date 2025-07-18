import { useLoaderData } from "@remix-run/react";
import { useAtomValue, useSetAtom } from "jotai";
import {
  selectedBulkItemsAtom,
  selectedBulkItemsCountAtom,
  setSelectedBulkItemsAtom,
} from "~/atoms/list";
import { ALL_SELECTED_KEY, isSelectingAllItems } from "~/utils/list";
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
};

export default function ListTitle({
  title,
  hasBulkActions,
  disableSelectAllItems = false,
  itemsGetter,
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
      <h5 className="text-left capitalize">{title || plural}</h5>
      <div className="h-7">
        {hasBulkActions && hasSelectedItems ? (
          <div className="flex items-start gap-2">
            <Button
              onClick={() => setSelectedBulkItems([])}
              variant="secondary"
              className="p-1 text-[14px]"
            >
              <span className="block size-2">
                <svg
                  width="100%"
                  height="100%"
                  viewBox="0 0 10 10"
                  fill="none"
                  xmlns="http://www.w3.org/2000/svg"
                >
                  <path
                    d="M9 1 1 9m0-8 8 8"
                    stroke="currentColor"
                    strokeWidth={1.333}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </span>
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
