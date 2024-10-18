import { useAssetIndexColumns } from "~/hooks/use-asset-index-columns";
import type { AdvancedIndexAsset } from "~/modules/asset/types";
import type { Column } from "~/modules/asset-index-settings/helpers";
// eslint-disable-next-line import/no-cycle
import { AdvancedIndexColumn } from "./advanced-asset-columns";

export const AdvancedAssetRow = ({ item }: { item: AdvancedIndexAsset }) => {
  const columns = useAssetIndexColumns();

  const _cols = [
    { name: "name", visible: true, position: 0 },
    ...columns,
  ] as Column[];

  return (
    <>
      {_cols.map((column) =>
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
