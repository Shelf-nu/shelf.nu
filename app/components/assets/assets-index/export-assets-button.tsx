import { useAtomValue } from "jotai";
import { selectedBulkItemsAtom } from "~/atoms/list";
import { Button } from "~/components/shared/button";
import { isSelectingAllItems } from "~/utils/list";

export function ExportAssetsButton() {
  const selectedAssets = useAtomValue(selectedBulkItemsAtom);
  const disabled = selectedAssets.length === 0;

  const allSelected = isSelectingAllItems(selectedAssets);
  const title = `Export selection ${
    disabled ? "" : allSelected ? "(All)" : `(${selectedAssets.length})`
  }`;
  return (
    <Button
      to={`/assets?export=true`}
      variant="secondary"
      download
      reloadDocument
      title={title}
      disabled={
        disabled
          ? { reason: "You must select at least 1 asset to export" }
          : false
      }
    >
      {title}
    </Button>
  );
}
