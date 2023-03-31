import { useMemo } from "react";

import { useLoaderData } from "@remix-run/react";
import type { IndexResponse } from "~/routes/_layout+/items._index";

import { EmptyState } from "./empty-state";

import { ListItem } from "./list-item";
import { PageNumber } from "./page-number";
import { Button } from "../shared/button";

/**
 * List components takes advantage use `useFetcher()`
 * to get the data of the parent route.
 *
 * The route is required to export {@link ListData}
 */
export const List = () => {
  const { page, items, totalItems, perPage, totalPages, search, next, prev } =
    useLoaderData<IndexResponse>();

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
          <div className=" flex justify-between border-b px-6 py-[14px] text-gray-600">
            {search ? (
              <p>
                {items.length} item{items.length > 1 && "s"}{" "}
                <span className="text-gray-400">out of {totalItems}</span>
              </p>
            ) : (
              <p>{totalItems} items</p>
            )}
          </div>

          <div>
            {items.map((item) => (
              <ListItem item={item} key={item.id} />
            ))}
          </div>

          <div className="flex items-center justify-between border-t px-6 py-[18px]">
            <Button
              variant="secondary"
              size="sm"
              to={prev}
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
              to={next}
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
