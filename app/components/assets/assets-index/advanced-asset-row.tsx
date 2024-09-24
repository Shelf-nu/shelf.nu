import { useAssetIndexColumns } from "~/hooks/use-asset-index-columns";
import type { AssetsFromViewItem } from "~/modules/asset/types";
// eslint-disable-next-line import/no-cycle
import { AdvancedIndexColumn } from "./advanced-asset-columns";

export const AdvancedAssetRow = ({ item }: { item: AssetsFromViewItem }) => {
  const columns = useAssetIndexColumns();
  return (
    <>
      {[{ name: "name", visible: true, position: 0 }, ...columns].map(
        (column) =>
          column.visible ? (
            <AdvancedIndexColumn
              column={column.name}
              item={item}
              key={column.name}
            />
          ) : null
      )}
    </>
  );
};
