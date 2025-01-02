import { useLoaderData } from "@remix-run/react";
import {
  ChevronRight,
  ChevronLeftDoubleIcon,
} from "~/components/icons/library";
import { Button } from "~/components/shared/button";
import { usePagination } from "~/hooks/use-pagination";
import { tw } from "~/utils/tw";
import type { IndexResponse } from "..";
import PerPageItemsSelect from "./per-page-items-select";

export const Pagination = ({ className }: { className?: string }) => {
  const { modelName } = useLoaderData<IndexResponse>();
  const {
    page,
    totalPages,
    goToPage,
    prevDisabled,
    nextDisabled,
    totalItems,
    perPage,
  } = usePagination();

  const total = Math.ceil(totalPages) || Math.ceil(totalItems / perPage);

  return (
    <div
      className={tw(
        "flex flex-wrap items-center justify-center gap-3 px-1 pb-4 pt-3 md:px-4",
        className
      )}
    >
      <div className="inline-flex items-center rounded border border-gray-300 shadow-[0px_1px_2px_0px_rgba(16,24,40,0.05)]">
        <Button
          variant="secondary"
          size="sm"
          onClick={() => goToPage(1)}
          disabled={prevDisabled}
          className="rounded-none border-y-0 border-l-0 border-r border-gray-300 bg-transparent px-3 py-[4px] hover:bg-transparent"
          aria-label="Go to page 1"
        >
          <ChevronLeftDoubleIcon />
        </Button>

        <Button
          variant="secondary"
          size="sm"
          onClick={() => goToPage(page - 1)}
          disabled={prevDisabled}
          className="h-8 w-10 rotate-180 rounded-none border-y-0 border-l border-r-0 border-gray-300 bg-transparent px-3 py-[4px] hover:bg-transparent"
          aria-label="Go to previous page"
        >
          <ChevronRight />
        </Button>

        <div className="flex items-center gap-2 px-2.5 py-[4px] leading-none text-gray-400">
          <span className="whitespace-nowrap text-[14px] font-medium text-gray-500">
            Page
          </span>
          <span className="whitespace-nowrap text-[14px] font-semibold text-gray-700">
            {page}
          </span>
          <span className="whitespace-nowrap text-[14px] font-medium text-gray-500">
            of
          </span>
          <span className="whitespace-nowrap text-[14px] font-semibold text-gray-700">
            {total === 0 ? 1 : total}
          </span>
        </div>

        <Button
          variant="secondary"
          size="sm"
          onClick={() => goToPage(page + 1)}
          disabled={nextDisabled}
          className="h-8 w-10 rounded-none border-y-0 border-l border-r-0 border-gray-300 bg-transparent px-3 py-[4px] hover:bg-transparent"
          aria-label="Go to next page"
        >
          <ChevronRight />
        </Button>

        <Button
          variant="secondary"
          size="sm"
          onClick={() => goToPage(totalPages)}
          disabled={nextDisabled}
          className="rotate-180 rounded-none border-y-0 border-l-0 border-r border-gray-300 bg-transparent px-3 py-[4px] hover:bg-transparent"
          aria-label="Go to last page"
        >
          <ChevronLeftDoubleIcon />
        </Button>
      </div>
      <div className="flex items-center gap-2">
        <PerPageItemsSelect />
        <p className="hidden text-[14px] font-medium text-gray-500 lg:block">
          <span className="capitalize">{modelName.plural}</span> per page
        </p>
      </div>
    </div>
  );
};
