"use client";

import { forwardRef } from "react";
import { ChevronLeftIcon, ChevronRightIcon } from "@radix-ui/react-icons";
import { DayPicker } from "react-day-picker";

import { tw } from "~/utils";

export type CalendarProps = React.ComponentProps<typeof DayPicker>;

const Calendar = forwardRef<
  React.ElementRef<any>,
  React.ComponentPropsWithoutRef<any>
>(function Calendar(
  {
    className,
    classNames,
    showOutsideDays = true,
    selected,
    onSelect,
    ...props
  },
  _ref
) {
  return (
    <>
      <DayPicker
        onSelect={(_range: unknown, d: Date) => {
          onSelect(d);
        }}
        selected={selected}
        showOutsideDays={showOutsideDays}
        className={tw(
          "border-indigo z-100 z-50 border-4 bg-slate-200 p-3",
          className
        )}
        classNames={{
          months:
            "flex flex-col sm:flex-row space-y-4 sm:space-x-4 sm:space-y-0",
          month: "space-y-4",
          caption: "flex justify-center pt-1 relative items-center",
          caption_label: "text-sm font-medium",
          nav: "space-x-1 flex items-center",
          nav_button: tw(
            "h-7 w-7 bg-transparent p-0 opacity-50 hover:opacity-100"
          ),
          nav_button_previous: "absolute left-1",
          nav_button_next: "absolute right-1",
          table: "w-full border-collapse space-y-1",
          head_row: "flex",
          head_cell:
            "text-muted-foreground rounded-md w-8 font-normal text-[0.8rem]",
          row: "flex w-full mt-2",
          cell: tw(
            "[&:has([aria-selected])]:bg-accent relative p-0 text-center text-sm focus-within:relative focus-within:z-20",
            props.mode === "range"
              ? "[&:has(>.day-range-end)]:rounded-r-md [&:has(>.day-range-start)]:rounded-l-md first:[&:has([aria-selected])]:rounded-l-md last:[&:has([aria-selected])]:rounded-r-md"
              : "[&:has([aria-selected])]:rounded-md"
          ),
          day: tw("h-8 w-8 p-0 font-normal aria-selected:opacity-100"),
          day_range_start: "day-range-start",
          day_range_end: "day-range-end",
          day_selected:
            "bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground focus:bg-primary focus:text-primary-foreground",
          day_today: "bg-accent text-accent-foreground",
          day_outside: "text-muted-foreground opacity-50",
          day_disabled: "text-muted-foreground opacity-50",
          day_range_middle:
            "aria-selected:bg-accent aria-selected:text-accent-foreground",
          day_hidden: "invisible",
          ...classNames,
        }}
        components={{
          IconLeft: () => <ChevronLeftIcon className="h-4 w-4" />,
          IconRight: () => <ChevronRightIcon className="h-4 w-4" />,
        }}
        {...props}
      />
    </>
  );
});

// Calendar.displayName = "Calendar"

export { Calendar };
