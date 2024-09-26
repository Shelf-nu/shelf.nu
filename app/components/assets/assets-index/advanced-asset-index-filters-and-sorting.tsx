import { useState } from "react";
import {
  Popover,
  PopoverTrigger,
  PopoverPortal,
  PopoverContent,
} from "@radix-ui/react-popover";
import { Button } from "~/components/shared/button";
import { tw } from "~/utils/tw";

export function AdvancedFilteringAndSorting() {
  return (
    <>
      <AdvancedFilter /> <AdvancedSorting />
    </>
  );
}

const getTriggerClasses = (open: boolean) =>
  tw("text-gray-500", open ? "bg-gray-50" : "");

function AdvancedFilter() {
  const [isPopoverOpen, setIsPopoverOpen] = useState(false);

  return (
    <Popover open={isPopoverOpen} onOpenChange={setIsPopoverOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="secondary"
          className={getTriggerClasses(isPopoverOpen)}
          icon="filter"
        >
          Filter
        </Button>
      </PopoverTrigger>
      <PopoverPortal>
        <PopoverContent
          align="start"
          className={tw(
            "mt-2 w-[480px] rounded-md border border-gray-200 bg-white p-3"
          )}
        >
          Hello
        </PopoverContent>
      </PopoverPortal>
    </Popover>
  );
}

function AdvancedSorting() {
  const [isPopoverOpen, setIsPopoverOpen] = useState(false);

  return (
    <Popover open={isPopoverOpen} onOpenChange={setIsPopoverOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="secondary"
          className={getTriggerClasses(isPopoverOpen)}
          icon="sort"
        >
          Sort
        </Button>
      </PopoverTrigger>
      <PopoverPortal>
        <PopoverContent
          align="start"
          className={tw(
            "mt-2  w-[480px] rounded-md border border-gray-200 bg-white p-3"
          )}
        >
          Hello
        </PopoverContent>
      </PopoverPortal>
    </Popover>
  );
}
