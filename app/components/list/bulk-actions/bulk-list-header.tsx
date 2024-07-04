import { useLoaderData } from "@remix-run/react";
import { useAtomValue, useSetAtom } from "jotai";
import {
  selectedBulkItemsCountAtom,
  setSelectedBulkItemsAtom,
} from "~/atoms/list";
import { FakeCheckbox } from "~/components/forms/fake-checkbox";
import { PartialCheckboxIcon } from "~/components/icons/library";
import { Th } from "~/components/table";
import { tw } from "~/utils/tw";
import type { IndexResponse } from "..";

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

  return (
    <Th className="table-cell md:pl-4 md:pr-3">
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
