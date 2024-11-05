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
import type { IndexResponse } from "..";

export default function BulkListHeader({
  ...rest
}: {} & React.ThHTMLAttributes<HTMLTableCellElement>) {
  const { items } = useLoaderData<IndexResponse>();
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
