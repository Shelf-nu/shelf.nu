import { useLoaderData } from "@remix-run/react";
import type { IndexResponse } from "~/routes/_layout+/assets._index";

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
    <div className="-mx-4 border border-gray-200 bg-white  md:mx-0 md:rounded-[12px]">
      {!hasItems ? (
        <EmptyState />
      ) : (
        <>
          <table className=" w-full table-auto border-collapse">
            <ListHeader>
              <th className="hidden border-b p-4 text-left font-normal text-gray-600 md:table-cell md:px-6">
                Category
              </th>
              <th className="hidden border-b p-4 text-left font-normal text-gray-600 md:table-cell md:px-6">
                Tags
              </th>
            </ListHeader>
            <tbody>
              {items.map((item) => (
                <ListItem item={item} key={item.id}>
                  <ItemComponent item={item} />
                </ListItem>
              ))}
            </tbody>
          </table>
          <Pagination />
        </>
      )}
    </div>
  );
};
