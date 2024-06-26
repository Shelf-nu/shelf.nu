import { useLoaderData } from "@remix-run/react";
import { useAtomValue, useSetAtom } from "jotai";
import {
  selectedBulkItemsCountAtom,
  setSelectedBulkItemsAtom,
} from "~/atoms/list";
import { FakeCheckbox } from "~/components/forms/fake-checkbox";
import { PartialCheckboxIcon } from "~/components/icons/library";
import { Th } from "~/components/table";
import type { IndexResponse } from "~/routes/_layout+/assets._index";
import { ALL_SELECTED_KEY } from "~/utils/list";
import { tw } from "~/utils/tw";

export default function BulkListHeader() {
  const { items } = useLoaderData<IndexResponse>();

  const setSelectedBulkItems = useSetAtom(setSelectedBulkItemsAtom);
  const itemsSelected = useAtomValue(selectedBulkItemsCountAtom);

  const partialItemsSelected =
    itemsSelected > 0 && itemsSelected < items.length;

  const allItemsSelected = itemsSelected >= items.length;

  function handleSelectAllIncomingItems() {
    setSelectedBulkItems(allItemsSelected ? [] : items.map((item) => item.id));
  }

  /**
   * We can select all the incoming items and we can add ALL_SELECTED_KEY
   * in the selected items. We check in backend for this ALL_SELECTED_KEY, if it is selected
   * then we do operation on all items of organization
   */
  function handleSelectAllItems() {
    setSelectedBulkItems([...items.map((item) => item.id), ALL_SELECTED_KEY]);
  }

  return (
    <Th className="hidden md:table-cell md:px-4">
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
    </Th>
  );
}
