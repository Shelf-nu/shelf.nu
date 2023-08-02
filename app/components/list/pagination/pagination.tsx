import { useMemo } from "react";
import { useLoaderData, useNavigate, useSearchParams } from "@remix-run/react";
import ReactPaginate from "react-paginate";
import type { IndexResponse } from "~/routes/_layout+/assets._index";
import { getParamsValues, mergeSearchParams } from "~/utils";

export const Pagination = () => {
  const { page, totalItems, totalPages, perPage, next, prev } =
    useLoaderData<IndexResponse>();

  const [searchParams] = useSearchParams();
  const { search, categoriesIds } = getParamsValues(searchParams);
  const isFiltering = search || categoriesIds;
  const navigate = useNavigate();
  const { prevDisabled, nextDisabled } = useMemo(
    () => ({
      prevDisabled: totalPages <= 1 || page <= 1,
      nextDisabled: totalPages <= 1 || page * perPage >= totalItems,
    }),
    [page, totalPages, perPage, totalItems]
  );

  const handlePageClick = (item: { selected: number }) => {
    const to = isFiltering
      ? mergeSearchParams(searchParams, { page: item.selected + 1 })
      : `.?page=${item.selected + 1}`;
    navigate(to);
  };

  return (
    <div className="flex items-center justify-between  px-6 py-[18px]">
      <ReactPaginate
        pageCount={totalPages}
        nextLabel={"Next >"}
        previousLabel={"< Previous"}
        onPageChange={handlePageClick}
        previousLinkClassName={prevDisabled ? "pointer-events-none" : ""}
        nextLinkClassName={nextDisabled ? "pointer-events-none" : ""}
      />
      {/* <Button variant="secondary" size="sm" to={prev} disabled={prevDisabled}>
        {"< Previous"}
      </Button>

      <div className="flex items-center gap-2 py-2 text-gray-400">
        <span>{page === 0 ? 1 : page}</span>
        <span>/</span>
        <span>{totalPages}</span>
      </div>

      <Button variant="secondary" size="sm" to={next} disabled={nextDisabled}>
        {"Next >"}
      </Button> */}
    </div>
  );
};
