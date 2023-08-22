import { useMemo } from "react";
import { useLoaderData } from "@remix-run/react";
import { ArrowLeftIcon, ArrowRightIcon } from "~/components/icons";
import { Button } from "~/components/shared/button";
import type { IndexResponse } from "~/routes/_layout+/assets._index";
import { tw } from "~/utils";
import PerPageItemsSelect from "./per-page-items-select";

export const Pagination = () => {
  const { page, totalItems, totalPages, perPage, next, prev, modelName } =
    useLoaderData<IndexResponse>();

  const { prevDisabled, nextDisabled } = useMemo(
    () => ({
      prevDisabled: totalPages <= 1 || page <= 1,
      nextDisabled: totalPages <= 1 || page * perPage >= totalItems,
    }),
    [page, totalPages, perPage, totalItems]
  );

  return (
    <div className="flex items-center justify-center gap-3 px-6 pb-4 pt-3">
      <div className="inline-flex items-center rounded-lg border border-gray-300 shadow-[0px_1px_2px_0px_rgba(16,24,40,0.05)]">
        <Button
          variant="secondary"
          size="sm"
          to={prev}
          disabled={prevDisabled}
          className={tw(
            "rounded-none border-y-0 border-l-0 border-r border-gray-300 bg-transparent px-4 py-3 hover:bg-transparent",
            prevDisabled && "opacity-50"
          )}
        >
          <ArrowLeftIcon />
        </Button>

        <div className="flex items-center gap-2 px-2.5 py-3 leading-none text-gray-400">
          <span className="text-[14px] font-semibold text-gray-700">
            {(page - 1) * perPage + 1} -{" "}
            {perPage * page > totalItems ? totalItems : perPage * page}
          </span>
          <span className="text-[14px] font-medium text-gray-500">of</span>
          <span className="text-[14px] font-semibold text-gray-700">
            {totalItems}
          </span>
        </div>

        <Button
          variant="secondary"
          size="sm"
          to={next}
          disabled={nextDisabled}
          className={tw(
            "rounded-none border-y-0 border-l border-r-0 border-gray-300 bg-transparent px-4 py-3 hover:bg-transparent",
            nextDisabled && "opacity-50"
          )}
        >
          <ArrowRightIcon />
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
