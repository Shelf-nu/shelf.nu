import React from "react";

import { useLoaderData } from "@remix-run/react";
import type { IndexResponse } from "~/routes/_layout+/items._index";

import { EmptyState } from "./empty-state";

import { ListItem } from "./list-item";
import { Pagination } from "./pagination";

/**
 * List components takes advantage use `useFetcher()`
 * to get the data of the parent route.
 *
 * The route is required to export {@link IndexResponse}
 */
export const List = ({ ItemComponent }: { ItemComponent: any }) => {
  const { items, totalItems, perPage, modelName } =
    useLoaderData<IndexResponse>();
  const { singular, plural } = modelName;

  const hasItems = items?.length > 0;

  return (
    <main className="rounded-[12px] border border-gray-200 bg-white">
      {!hasItems ? (
        <EmptyState />
      ) : (
        <div>
          <div className=" flex justify-between border-b px-6 py-[14px] text-gray-600">
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

          <div>
            {items.map((item) => (
              <ListItem item={item} key={item.id}>
                <ItemComponent item={item} />
              </ListItem>
            ))}
          </div>

          <Pagination />
        </div>
      )}
    </main>
  );
};
