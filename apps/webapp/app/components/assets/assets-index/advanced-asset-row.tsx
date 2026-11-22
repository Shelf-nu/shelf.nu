import { memo, useMemo } from "react";
import type { ListContextLinkState } from "~/hooks/use-list-context";
import type { AdvancedIndexAsset } from "~/modules/asset/types";
import type { Column } from "~/modules/asset-index-settings/helpers";
// eslint-disable-next-line import/no-cycle
import { AdvancedIndexColumn } from "./advanced-asset-columns";

const NAME_COLUMN: Column = { name: "name", visible: true, position: 0 };

/**
 * Renders a single asset row in the advanced table view.
 *
 * Columns are passed from AssetsList via extraProps so the
 * useAssetIndexColumns hook only runs once in the parent,
 * not once per row.
 *
 * @param item - The asset data for this row.
 * @param extraProps.columns - Visible column definitions from the parent.
 * @param extraProps.linkState - History state for the name link, so the asset
 *   page it opens can step through this list. Only the asset index passes it.
 */
export const AdvancedAssetRow = memo(function AdvancedAssetRow({
  item,
  extraProps,
}: {
  item: AdvancedIndexAsset;
  extraProps?: { columns?: Column[]; linkState?: ListContextLinkState };
}) {
  const rawColumns = extraProps?.columns;
  const linkState = extraProps?.linkState;

  const _cols = useMemo(
    () => [NAME_COLUMN, ...(rawColumns ?? [])] as Column[],
    [rawColumns]
  );

  return (
    <>
      {_cols.map((column) =>
        column.visible ? (
          <AdvancedIndexColumn
            column={column.name}
            item={item}
            linkState={linkState}
            key={column.name}
          />
        ) : null
      )}
    </>
  );
});
