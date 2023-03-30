import { useMemo } from "react";

import { useLoaderData } from "@remix-run/react";
import { EmptyState } from "./empty-state";

import { ListItem } from "./list-item";
import type { ListItemData } from "./list-item";
import { PageNumber } from "./page-number";
import { Button } from "../shared/button";

export interface ListData {
  /** Page number. Starts at 1 */
  page: number;

  /** Items to be loaded per page */
  perPage: number;

  /** Items to be rendered in the list */
  items: ListItemData[];

  totalItems: number;

  totalPages: number;
}

/**
 * List components takes advantage use `useFetcher()`
 * to get the data of the parent route.
 *
 * The route is required to export {@link ListData}
 */
export const List = () => {
  const { page, items, totalItems, perPage, totalPages } =
    useLoaderData<ListData>();

  const hasItems = items?.length > 0;

  const pageNumbers = useMemo(() => {
    const pages = [];
    for (let i = 1; i <= totalPages; i++) {
      pages.push(i);
    }
    return pages;
  }, [totalPages]);
  return (
    <main className="rounded-[12px] border border-gray-200 bg-white">
      {!hasItems ? (
        <EmptyState />
      ) : (
        <div>
          <div className="flex justify-between border-b px-6 py-[14px] text-gray-600">
            {totalItems} items
          </div>

          <div>
            {items.map((item) => (
              <ListItem item={item} key={item.id} />
            ))}
          </div>

          <div className="flex items-center justify-between px-6 py-[18px]">
            <Button
              variant="secondary"
              size="sm"
              to={`.?page=${page - 1}`}
              disabled={page <= 1}
            >
              {"< Previous"}
            </Button>
            <ul className="flex gap-[2px]">
              {pageNumbers.map((pageNumber) => (
                <PageNumber number={pageNumber} page={page} key={pageNumber} />
              ))}
            </ul>
            <Button
              variant="secondary"
              size="sm"
              to={`.?page=${page + 1}`}
              disabled={page * perPage >= totalItems}
            >
              {"Next >"}
            </Button>
          </div>
        </div>
      )}
    </main>
  );
};
