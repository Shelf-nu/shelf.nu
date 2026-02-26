import * as React from "react";
import type { ComponentPropsWithoutRef, ComponentRef } from "react";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";

import { tw } from "~/utils/tw";

const TooltipProvider = TooltipPrimitive.Provider;

// const Tooltip = TooltipPrimitive.Root;

type TooltipProps = ComponentPropsWithoutRef<typeof TooltipPrimitive.Root>;

const Tooltip = ({ delayDuration = 100, ...props }: TooltipProps) => (
  <TooltipPrimitive.Root delayDuration={delayDuration} {...props} />
);

const TooltipTrigger = TooltipPrimitive.Trigger;

type TooltipContentElement = ComponentRef<typeof TooltipPrimitive.Content>;
type TooltipContentProps = ComponentPropsWithoutRef<
  typeof TooltipPrimitive.Content
>;

const TooltipContent = React.forwardRef<
  TooltipContentElement,
  TooltipContentProps
>(function TooltipContent({ className, sideOffset = 6, ...props }, ref) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content
        ref={ref}
        sideOffset={sideOffset}
        className={tw(
          " text-popover-foreground z-50 overflow-hidden rounded-md border bg-surface p-3 text-sm font-medium shadow-lg animate-in fade-in-0 zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2",
          className
        )}
        {...props}
      />
    </TooltipPrimitive.Portal>
  );
});

export { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider };
