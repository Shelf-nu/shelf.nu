import { useLoaderData } from "@remix-run/react";
import { HelpIcon } from "~/components/icons/library";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "~/components/shared/tooltip";
import type { SearchableIndexResponse } from "~/modules/types";

export const SearchFieldTooltip = () => {
  const { searchFieldTooltip } = useLoaderData<SearchableIndexResponse>();
  return searchFieldTooltip ? (
    <TooltipProvider delayDuration={100}>
      <Tooltip>
        <TooltipTrigger asChild>
          <i className="absolute right-3.5 top-1/2 flex -translate-y-1/2 cursor-pointer text-gray-400 hover:text-gray-700">
            <HelpIcon />
          </i>
        </TooltipTrigger>
        <TooltipContent side="bottom">
          <div className="max-w-[260px] sm:max-w-[320px]">
            <h6 className="mb-1 text-xs font-semibold text-gray-700">
              {searchFieldTooltip.title}
            </h6>
            <p className="text-xs font-medium text-gray-500">
              {searchFieldTooltip.text}
            </p>
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  ) : null;
};
