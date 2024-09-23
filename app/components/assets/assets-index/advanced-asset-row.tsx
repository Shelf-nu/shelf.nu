import type { Asset, Category, Custody, Kit, Tag } from "@prisma/client";

import { useAssetIndexColumns } from "~/hooks/use-asset-index-columns";
// eslint-disable-next-line import/no-cycle
import { AdvancedIndexColumn } from "./advanced-asset-columns";

export const AdvancedAssetRow = ({
  item,
}: {
  item: Asset & {
    kit: Kit;
    category?: Category;
    tags?: Tag[];
    custody: Custody & {
      custodian: {
        name: string;
        user?: {
          firstName: string | null;
          lastName: string | null;
          profilePicture: string | null;
          email: string | null;
        };
      };
    };
    location: {
      name: string;
    };
    customFields: any;
  };
}) => {
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
