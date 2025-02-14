import { useAtomValue, useSetAtom } from "jotai";
import { selectedBulkItemsAtom, setSelectedBulkItemAtom } from "~/atoms/list";
import { freezeColumnClassNames } from "~/components/assets/assets-index/freeze-column-classes";
import { FakeCheckbox } from "~/components/forms/fake-checkbox";
import { Td } from "~/components/table";
import { useAssetIndexFreezeColumn } from "~/hooks/use-asset-index-freeze-column";
import { useAssetIndexViewState } from "~/hooks/use-asset-index-view-state";
// import { useAssetIndexShowImage } from "~/hooks/use-asset-index-show-image";
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
  const freezeColumn = useAssetIndexFreezeColumn();
  const { modeIsAdvanced } = useAssetIndexViewState();

  const checked = !!selectedBulkItems.find((i) => i.id === item.id);

  function handleBulkItemSelection(
    e: React.MouseEvent<HTMLTableCellElement, MouseEvent>
  ) {
    e.preventDefault();
    e.stopPropagation();

    setSelectedBulkItem(item);
  }

  return (
    <Td
      className={tw(
        "md:pl-4 md:pr-3",
        modeIsAdvanced && freezeColumn ? freezeColumnClassNames.checkbox : ""
      )}
      onClick={handleBulkItemSelection}
    >
      <div>
        <FakeCheckbox
          className={tw(
            "overflow-visible text-white",
            checked ? "text-primary" : ""
          )}
          checked={checked}
        />
      </div>
    </Td>
  );
}
