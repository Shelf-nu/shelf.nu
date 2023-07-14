import { useLoaderData } from "@remix-run/react";
import type { IndexResponse } from "~/routes/_layout+/assets._index";

export const ListHeader = ({ children }: { children?: React.ReactNode }) => {
  const { items, totalItems, perPage, modelName } =
    useLoaderData<IndexResponse>();
  const { singular, plural } = modelName;

  return (
    <thead>
      <tr className="">
        <th
          className="border-b text-left font-normal text-gray-600"
          colSpan={children ? 1 : 100}
        >
          <div className="flex justify-between px-6 py-[14px] ">
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
        </th>
        {children}
      </tr>
    </thead>
  );
};
