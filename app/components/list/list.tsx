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
export const List = () => {
  const { items, totalItems, perPage } = useLoaderData<IndexResponse>();

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
                {items.length} item{items.length > 1 && "s"}{" "}
                <span className="text-gray-400">out of {totalItems}</span>
              </p>
            ) : (
              <span>{totalItems} items</span>
            )}
          </div>

          <div>
            {items.map((item) => (
              <ListItem item={item} key={item.id} />
            ))}
          </div>

          <Pagination />
        </div>
      )}
    </main>
  );
};
