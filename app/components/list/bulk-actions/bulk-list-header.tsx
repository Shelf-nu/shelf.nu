import { useLoaderData } from "@remix-run/react";
import { useAtom } from "jotai";
import { selectedBulkItemsAtom } from "~/atoms/list";
import { FakeCheckbox } from "~/components/forms/fake-checkbox";
import { PartialCheckboxIcon } from "~/components/icons/library";
import { Th } from "~/components/table";
import type { IndexResponse } from "~/routes/_layout+/assets._index";
import { ALL_SELECTED_KEY } from "~/utils/list";
import { tw } from "~/utils/tw";

export default function BulkListHeader() {
  const { items } = useLoaderData<IndexResponse>();

  const [selectedBulkItems, setSelectedBulkItems] = useAtom(
    selectedBulkItemsAtom
  );

  const partialItemsSelected =
    selectedBulkItems.length > 0 && selectedBulkItems.length < items.length;

  const allItemsSelected = selectedBulkItems.length >= items.length;

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
    <Th className="hidden md:table-cell">
      {partialItemsSelected ? (
        <PartialCheckboxIcon />
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
