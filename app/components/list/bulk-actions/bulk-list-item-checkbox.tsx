import { useAtom } from "jotai";
import { selectedBulkItemsAtom } from "~/atoms/list";
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
  const [selectedBulkItems, setSelectedBulkItems] = useAtom(
    selectedBulkItemsAtom
  );

  const checked = selectedBulkItems.includes(item.id);

  function handleBulkItemSelection(
    e: React.MouseEvent<HTMLTableCellElement, MouseEvent>
  ) {
    e.preventDefault();
    e.stopPropagation();

    setSelectedBulkItems((prev) => {
      /** Remove item if already selected */
      if (checked) {
        return [...prev.filter((i) => i !== item.id)];
      }

      return [...prev, item.id];
    });
  }

  return (
    <Td className="hidden md:table-cell" onClick={handleBulkItemSelection}>
      <FakeCheckbox
        className={tw("text-white", checked ? "text-primary" : "")}
        checked={checked}
      />
    </Td>
  );
}
