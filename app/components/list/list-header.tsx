import { useLoaderData } from "@remix-run/react";
import type { IndexResponse } from "~/routes/_layout+/assets._index";
import type { ListProps } from ".";
import BulkListHeader from "./bulk-actions/bulk-list-header";
import { Th } from "../table";

type ListHeaderProps = {
  children: React.ReactNode;
  hideFirstColumn?: boolean;
  bulkActions?: ListProps["bulkActions"];
};

export const ListHeader = ({
  children,
  hideFirstColumn = false,
  bulkActions,
}: ListHeaderProps) => {
  const { items, totalItems, perPage, modelName } =
    useLoaderData<IndexResponse>();
  const { singular, plural } = modelName;

  return (
    <thead className="border-b">
      <tr className="">
        {bulkActions ? <BulkListHeader /> : null}
        {hideFirstColumn ? null : (
          <Th
            className="text-left font-normal text-gray-600"
            colSpan={children ? 1 : 100}
          >
            <div className="flex justify-between">
              {perPage < totalItems ? (
                <p>
                  {items.length} {items.length > 1 ? plural : singular}{" "}
                  <span className="text-gray-400">out of {totalItems}</span>
                </p>
              ) : (
                <span>
                  {totalItems} {items.length > 1 ? plural : singular}
                </span>
              )}
            </div>
          </Th>
        )}
        {children}
      </tr>
    </thead>
  );
};
