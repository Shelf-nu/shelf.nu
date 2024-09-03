import { useAtomValue, useSetAtom } from "jotai";
import { selectedBulkItemsAtom, setSelectedBulkItemAtom } from "~/atoms/list";
import { FakeCheckbox } from "~/components/forms/fake-checkbox";
import { Td } from "~/components/table";
import { tw } from "~/utils/tw";
import type { ListItemData } from "../list-item";

type BulkListItemCheckboxProps = {
  item: ListItemData;
};

export default function BulkListItemCheckbox({
  item,
}: BulkListItemCheckboxProps) {
  const selectedBulkItems = useAtomValue(selectedBulkItemsAtom);
  const setSelectedBulkItem = useSetAtom(setSelectedBulkItemAtom);

  const checked = !!selectedBulkItems.find((i) => i.id === item.id);

  function handleBulkItemSelection(
    e: React.MouseEvent<HTMLTableCellElement, MouseEvent>
  ) {
    e.preventDefault();
    e.stopPropagation();

    setSelectedBulkItem(item);
  }

  return (
    <Td className="md:pl-4 md:pr-3" onClick={handleBulkItemSelection}>
      <FakeCheckbox
        className={tw(
          "overflow-visible text-white",
          checked ? "text-primary" : ""
        )}
        checked={checked}
      />
    </Td>
  );
}
