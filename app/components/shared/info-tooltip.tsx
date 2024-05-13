import type { ReactNode } from "react";
import { InfoIcon } from "~/components/icons/library";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "~/components/shared/tooltip";

export const InfoTooltip = ({
  icon,
  content,
}: {
  icon?: ReactNode;
  content: ReactNode;
}) => (
  <TooltipProvider delayDuration={100}>
    <Tooltip>
      <TooltipTrigger asChild>
        <i className="inline-block cursor-pointer align-middle text-gray-400 hover:text-gray-700">
          {icon ? icon : <InfoIcon />}
        </i>
      </TooltipTrigger>
      <TooltipContent side="bottom">
        <div className="max-w-[260px] rounded text-left sm:max-w-[320px]">
          {content}
        </div>
      </TooltipContent>
    </Tooltip>
  </TooltipProvider>
);
