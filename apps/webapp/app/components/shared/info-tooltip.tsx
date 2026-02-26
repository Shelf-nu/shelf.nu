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
}: {
  icon?: ReactNode;
  iconClassName?: string;
  content: ReactNode;
}) => (
  <TooltipProvider delayDuration={100}>
    <Tooltip>
      <TooltipTrigger asChild>
        <i className="inline-block cursor-pointer align-middle text-color-400 hover:text-color-700">
          {icon ? icon : <Info className={tw("size-5", iconClassName)} />}
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
