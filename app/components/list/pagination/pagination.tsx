import { useMemo } from "react";
import { useLoaderData } from "@remix-run/react";
import { Button } from "~/components/shared/button";
import type { IndexResponse } from "~/routes/_layout+/items._index";
import { PageNumber } from "./page-number";

export const Pagination = () => {
  const { page, totalItems, totalPages, perPage, next, prev } =
    useLoaderData<IndexResponse>();

  const pageNumbers = useMemo(() => {
    const pages = [];
    for (let i = 1; i <= totalPages; i++) {
      pages.push(i);
    }
    return pages;
  }, [totalPages]);

  return (
    <div className="flex items-center justify-between border-t px-6 py-[18px]">
      <Button variant="secondary" size="sm" to={prev} disabled={page <= 1}>
        {"< Previous"}
      </Button>

      <ul className="flex gap-[2px]">
        {pageNumbers.map((pageNumber) => (
          <PageNumber number={pageNumber} key={pageNumber} />
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
  );
};
