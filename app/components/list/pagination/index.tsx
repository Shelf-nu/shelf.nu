import { useLoaderData } from "@remix-run/react";
import {
  ChevronRight,
  ChevronLeftDoubleIcon,
} from "~/components/icons/library";
import { Button } from "~/components/shared/button";
import { usePagination } from "~/hooks/use-pagination";
import { tw } from "~/utils/tw";
import PerPageItemsSelect from "./per-page-items-select";
import type { IndexResponse } from "..";

export const Pagination = ({ className }: { className?: string }) => {
  const { modelName } = useLoaderData<IndexResponse>();
  const {
    page,
    totalPages,
    totalItems,
    perPage,
    goToPage,
    prevDisabled,
    nextDisabled,
  } = usePagination();

  return (
    <div
      className={tw(
        "flex flex-wrap items-center justify-center gap-3 px-6 pb-4 pt-3",
        className
      )}
    >
      <div className="inline-flex items-center rounded border border-gray-300 shadow-[0px_1px_2px_0px_rgba(16,24,40,0.05)]">
        <Button
          variant="secondary"
          size="sm"
          onClick={() => goToPage(1)}
          disabled={prevDisabled}
          className={tw(
            "rounded-none border-y-0 border-l-0 border-r border-gray-300 bg-transparent px-3 py-[9px] hover:bg-transparent"
          )}
        >
          <ChevronLeftDoubleIcon />
        </Button>

        <Button
          variant="secondary"
          size="sm"
          onClick={() => goToPage(page - 1)}
          disabled={prevDisabled}
          className={tw(
            "h-9 w-10 rotate-180 rounded-none border-y-0 border-l border-r-0 border-gray-300 bg-transparent px-3 py-[9px] hover:bg-transparent"
          )}
        >
          <ChevronRight />
        </Button>

        <div className="flex items-center gap-2 px-2.5 py-[9px] leading-none text-gray-400">
          <span className="whitespace-nowrap text-[14px] font-semibold text-gray-700">
            {(page - 1) * perPage + 1} -{" "}
            {perPage * page > totalItems ? totalItems : perPage * page}
          </span>
          <span className="whitespace-nowrap text-[14px] font-medium text-gray-500">
            of
          </span>
          <span className="whitespace-nowrap text-[14px] font-semibold text-gray-700">
            {totalItems}
          </span>
        </div>

        <Button
          variant="secondary"
          size="sm"
          onClick={() => goToPage(page + 1)}
          disabled={nextDisabled}
          className={tw(
            "h-9 w-10 rounded-none border-y-0 border-l border-r-0 border-gray-300 bg-transparent px-3 py-[9px] hover:bg-transparent"
          )}
        >
          <ChevronRight />
        </Button>

        <Button
          variant="secondary"
          size="sm"
          onClick={() => goToPage(totalPages)}
          disabled={nextDisabled}
          className={tw(
            "rotate-180 rounded-none border-y-0 border-l-0 border-r border-gray-300 bg-transparent px-3 py-[9px] hover:bg-transparent"
          )}
        >
          <ChevronLeftDoubleIcon />
        </Button>
      </div>
      <div className="flex items-center gap-2">
        <PerPageItemsSelect />
        <p className="hidden text-[14px] font-medium text-gray-400 lg:block">
          <span className="capitalize">{modelName.plural}</span> per page
        </p>
      </div>
    </div>
  );
};
