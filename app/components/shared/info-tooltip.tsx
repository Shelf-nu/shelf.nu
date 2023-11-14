import type { ReactNode } from "react";
import { InfoIcon } from "~/components/icons";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "~/components/shared/tooltip";

export const InfoTooltip = ({ content }: { content: ReactNode }) => (
  <TooltipProvider>
    <Tooltip>
      <TooltipTrigger asChild>
        <i className="inline-block cursor-pointer align-middle text-gray-400 hover:text-gray-700">
          <InfoIcon />
        </i>
      </TooltipTrigger>
      <TooltipContent side="bottom">
        <div className="max-w-[260px] text-left sm:max-w-[320px]">
          {content}
        </div>
      </TooltipContent>
    </Tooltip>
  </TooltipProvider>
);
