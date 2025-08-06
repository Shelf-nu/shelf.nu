import * as React from "react";
import * as ProgressPrimitive from "@radix-ui/react-progress";
import { tw } from "~/utils/tw";

function Progress({
  className,
  value,
  ...props
}: React.ComponentProps<typeof ProgressPrimitive.Root>) {
  const isComplete = (value || 0) === 100;

  return (
    <ProgressPrimitive.Root
      data-slot="progress"
      className={tw(
        "relative h-2 w-full overflow-hidden rounded-full bg-gray-200",
        className
      )}
      {...props}
    >
      <ProgressPrimitive.Indicator
        data-slot="progress-indicator"
        className={tw(
          "size-full flex-1 transition-all",
          isComplete ? "bg-green-500" : "bg-gray-400"
        )}
        style={{ transform: `translateX(-${100 - (value || 0)}%)` }}
      />
    </ProgressPrimitive.Root>
  );
}

export { Progress };
