import type { ReactNode } from "react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "~/components/shared/tooltip";

export const CustomTooltip = ({
  content,
  children,
}: {
  content: ReactNode;
  children: ReactNode;
}) => (
  <TooltipProvider>
    <Tooltip delayDuration={100}>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side="bottom">
        <div className="max-w-[260px] text-left sm:max-w-[320px]">
          {content}
        </div>
      </TooltipContent>
    </Tooltip>
  </TooltipProvider>
);
