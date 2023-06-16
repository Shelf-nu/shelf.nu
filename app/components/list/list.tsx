import type { ReactNode } from "react";
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
export const List = ({
  ItemComponent,
  headerChildren,
  navigate,
}: {
  ItemComponent: any;
  headerChildren: ReactNode;
  /** Function to be passed if the rows of the table should navigate */
  navigate?: (id: string) => void;
}) => {
  const { items } = useLoaderData<IndexResponse>();

  const hasItems = items?.length > 0;

  return (
    <div className="-mx-4 border border-gray-200 bg-white  md:mx-0 md:rounded-[12px]">
      {!hasItems ? (
        <EmptyState />
      ) : (
        <>
          <table className=" w-full table-auto border-collapse">
            <ListHeader>{headerChildren}</ListHeader>
            <tbody>
              {items.map((item) => (
                <ListItem item={item} key={item.id} navigate={navigate}>
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
