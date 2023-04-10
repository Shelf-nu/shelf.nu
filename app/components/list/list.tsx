import { useLoaderData } from "@remix-run/react";
import type { IndexResponse } from "~/routes/_layout+/items._index";

import { EmptyState } from "./empty-state";

import { ListHeader } from "./list-header";
import { ListItem } from "./list-item";
import { Pagination } from "./pagination";

/**
 * List components takes advantage use `useFetcher()`
 * to get the data of the parent route.
 *
 * The route is required to export {@link IndexResponse}
 */
export const List = ({ ItemComponent }: { ItemComponent: any }) => {
  const { items } = useLoaderData<IndexResponse>();

  const hasItems = items?.length > 0;

  return (
    <main className="rounded-[12px] border border-gray-200 bg-white">
      {!hasItems ? (
        <EmptyState />
      ) : (
        <div>
          <ListHeader />

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
