import { useLoaderData } from "@remix-run/react";
import type { IndexResponse } from "~/routes/_layout+/assets._index";
import { Th } from "../table";

export const ListHeader = ({
  children,
  hideFirstColumn = false,
}: {
  children?: React.ReactNode;
  hideFirstColumn?: boolean;
}) => {
  const { items, totalItems, perPage, modelName } =
    useLoaderData<IndexResponse>();
  const { singular, plural } = modelName;

  return (
    <thead className="border-b ">
      <tr className="">
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
