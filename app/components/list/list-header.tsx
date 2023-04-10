import { useLoaderData } from "@remix-run/react";
import type { IndexResponse } from "~/routes/_layout+/items._index";

export const ListHeader = () => {
  const { items, totalItems, perPage, modelName } =
    useLoaderData<IndexResponse>();
  const { singular, plural } = modelName;

  return (
    <div className=" flex justify-between border-b px-6 py-[14px] text-gray-600">
      <div>
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
    </div>
  );
};
