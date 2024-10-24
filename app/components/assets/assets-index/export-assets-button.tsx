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

  /** Get the assetIds from the atom and add them to assetIds search param */
  const assetIds = selectedAssets.map((asset) => asset.id);
  let url = `/assets/export/assets-${new Date()
    .toISOString()
    .slice(0, 10)}.csv`;
  if (assetIds.length > 0) {
    url += `?assetIds=${assetIds.join(",")}`;
  }
  return (
    <Button
      to={url}
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
