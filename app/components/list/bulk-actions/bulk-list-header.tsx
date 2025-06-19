import { useLoaderData } from "@remix-run/react";
import { useAtomValue, useSetAtom } from "jotai";
import {
  selectedBulkItemsCountAtom,
  setSelectedBulkItemsAtom,
} from "~/atoms/list";
import { freezeColumnClassNames } from "~/components/assets/assets-index/freeze-column-classes";
import { FakeCheckbox } from "~/components/forms/fake-checkbox";
import { PartialCheckboxIcon } from "~/components/icons/library";
import { Th } from "~/components/table";
import { useAssetIndexFreezeColumn } from "~/hooks/use-asset-index-freeze-column";
import { useAssetIndexViewState } from "~/hooks/use-asset-index-view-state";
import { tw } from "~/utils/tw";
import type { ListItemData } from "../list-item";

export type LoaderData = Record<string, ListItemData[]>;

type BulkListHeaderProps = React.ThHTMLAttributes<HTMLTableCellElement> & {
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

export default function BulkListHeader({
  itemsGetter,
  ...rest
}: BulkListHeaderProps) {
  const loaderData = useLoaderData<Record<string, ListItemData[]>>();
  const items =
    typeof itemsGetter === "function"
      ? itemsGetter(loaderData)
      : loaderData.items;

  const { modeIsAdvanced } = useAssetIndexViewState();
  const freezeColumn = useAssetIndexFreezeColumn();

  const setSelectedBulkItems = useSetAtom(setSelectedBulkItemsAtom);
  const totalItemsSelected = useAtomValue(selectedBulkItemsCountAtom);

  const partialItemsSelected =
    totalItemsSelected > 0 && totalItemsSelected < items.length;

  const allItemsSelected = totalItemsSelected >= items.length;

  function handleSelectAllIncomingItems() {
    setSelectedBulkItems(allItemsSelected ? [] : items);
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
            onClick={() => {
              setSelectedBulkItems([]);
            }}
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
