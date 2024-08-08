import { useMemo } from "react";
import { useLoaderData } from "@remix-run/react";
import type { IndexResponse } from "~/components/list";
import { useSearchParams } from "~/hooks/search-params";

/**
 * This base hook is used to get all the pagination data and actions
 */
export function usePagination() {
  const [, setSearchParams] = useSearchParams();
  const { totalItems, totalPages, perPage, page } =
    useLoaderData<IndexResponse>();

  function goToPage(value: number) {
    setSearchParams((prev) => {
      prev.set("page", String(value));
      return prev;
    });
  }

  const { prevDisabled, nextDisabled } = useMemo(
    () => ({
      prevDisabled: totalPages <= 1 || page <= 1,
      nextDisabled: totalPages <= 1 || page * perPage >= totalItems,
    }),
    [page, totalPages, perPage, totalItems]
  );

  return {
    page,
    totalPages,
    totalItems,
    perPage,
    goToPage,
    prevDisabled,
    nextDisabled,
  };
}
