import { useAtomValue, useSetAtom } from "jotai";
import {
  disabledBulkItemsAtom,
  selectedBulkItemsAtom,
  setSelectedBulkItemAtom,
} from "~/atoms/list";
import { freezeColumnClassNames } from "~/components/assets/assets-index/freeze-column-classes";
import { FakeCheckbox } from "~/components/forms/fake-checkbox";
import { Td } from "~/components/table";
import { useAssetIndexFreezeColumn } from "~/hooks/use-asset-index-freeze-column";
import { useAssetIndexViewState } from "~/hooks/use-asset-index-view-state";
import { tw } from "~/utils/tw";
import type { ListItemData } from "../list-item";

type BulkListItemCheckboxProps = {
  item: ListItemData;
};

export default function BulkListItemCheckbox({
  item,
}: BulkListItemCheckboxProps) {
  const selectedBulkItems = useAtomValue(selectedBulkItemsAtom);
  const disabledBulkItems = useAtomValue(disabledBulkItemsAtom);
  const setSelectedBulkItem = useSetAtom(setSelectedBulkItemAtom);
  const freezeColumn = useAssetIndexFreezeColumn();
  const { modeIsAdvanced } = useAssetIndexViewState();

  const disabled = disabledBulkItems.some((i) => i.id === item.id);
  const checked = !!selectedBulkItems.find((i) => i.id === item.id);

  function handleBulkItemSelection(
    e: React.MouseEvent<HTMLTableCellElement, MouseEvent>
  ) {
    e.preventDefault();
    e.stopPropagation();
    if (disabled) return;

    setSelectedBulkItem(item);
  }
  // console.log(item.title, item.id);

  return (
    <Td
      className={tw(
        "md:pl-4 md:pr-3",
        modeIsAdvanced && freezeColumn ? freezeColumnClassNames.checkbox : "",
        disabled ? "cursor-not-allowed" : ""
      )}
      onClick={handleBulkItemSelection}
    >
      <div>
        <FakeCheckbox
          className={tw(
            "overflow-visible text-white",
            checked ? "text-primary" : "",
            disabled ? "text-gray-200" : ""
          )}
          checked={checked}
        />
      </div>
    </Td>
  );
}
