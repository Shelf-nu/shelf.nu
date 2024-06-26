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

  const checked = selectedBulkItems.includes(item.id);

  function handleBulkItemSelection(
    e: React.MouseEvent<HTMLTableCellElement, MouseEvent>
  ) {
    e.preventDefault();
    e.stopPropagation();

    setSelectedBulkItem(item.id);
  }

  return (
    <Td
      className="hidden md:table-cell md:px-4"
      onClick={handleBulkItemSelection}
    >
      <FakeCheckbox
        className={tw("text-white", checked ? "text-primary" : "")}
        checked={checked}
      />
    </Td>
  );
}
