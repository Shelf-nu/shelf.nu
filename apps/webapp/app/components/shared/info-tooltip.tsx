import type { ReactNode } from "react";
import { Info } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "~/components/shared/tooltip";
import { tw } from "~/utils/tw";

export const InfoTooltip = ({
  icon,
  iconClassName,
  content,
  contentClassName,
}: {
  icon?: ReactNode;
  iconClassName?: string;
  content: ReactNode;
  /**
   * Extra classes for the tooltip content wrapper. Use this to raise the
   * z-index when the tooltip lives inside another portalled overlay (e.g. a
   * Popover with `z-[100]`), whose stacking context would otherwise hide the
   * default `z-50` tooltip behind it.
   */
  contentClassName?: string;
}) => (
  <TooltipProvider delayDuration={100}>
    <Tooltip>
      <TooltipTrigger asChild>
        <i className="inline-block cursor-pointer align-middle text-gray-400 hover:text-gray-700">
          {icon ? icon : <Info className={tw("size-5", iconClassName)} />}
        </i>
      </TooltipTrigger>
      <TooltipContent side="bottom" className={contentClassName}>
        <div className="max-w-[260px] rounded text-left sm:max-w-[320px]">
          {content}
        </div>
      </TooltipContent>
    </Tooltip>
  </TooltipProvider>
);
