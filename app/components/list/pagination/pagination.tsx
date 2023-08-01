import { useMemo } from "react";
import { useLoaderData } from "@remix-run/react";
import { Button } from "~/components/shared/button";
import type { IndexResponse } from "~/routes/_layout+/assets._index";

export const Pagination = () => {
  const { page, totalItems, totalPages, perPage, next, prev } =
    useLoaderData<IndexResponse>();

  const { prevDisabled, nextDisabled } = useMemo(
    () => ({
      prevDisabled: totalPages <= 1 || page <= 1,
      nextDisabled: totalPages <= 1 || page * perPage >= totalItems,
    }),
    [page, totalPages, perPage, totalItems]
  );

  return (
    <div className="flex items-center justify-between  px-6 py-[18px]">
      <Button variant="secondary" size="sm" to={prev} disabled={prevDisabled}>
        {"< Previous"}
      </Button>

      <div className="flex items-center gap-2 py-2 text-gray-400">
        <span>{page === 0 ? 1 : page}</span>
        <span>/</span>
        <span>{totalPages}</span>
      </div>

      <Button variant="secondary" size="sm" to={next} disabled={nextDisabled}>
        {"Next >"}
      </Button>
    </div>
  );
};
