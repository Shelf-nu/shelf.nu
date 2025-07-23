import type FullCalendar from "@fullcalendar/react";
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import { Button } from "../shared/button";
import { ButtonGroup } from "../shared/button-group";

export function CalendarNavigation({
  calendarRef,
  updateTitle,
}: {
  calendarRef: React.RefObject<FullCalendar>;
  updateTitle: () => void;
}) {
  function handleCalendarNavigation(navigateTo: "prev" | "today" | "next") {
    const calendarApi = calendarRef.current?.getApi();
    if (navigateTo === "prev") {
      calendarApi?.prev();
    } else if (navigateTo == "next") {
      calendarApi?.next();
    } else if (navigateTo == "today") {
      calendarApi?.gotoDate(new Date());
    }

    updateTitle();
  }

  return (
    <div className="mr-4">
      <ButtonGroup>
        <Button
          variant="secondary"
          className="border-r p-[0.7em] text-color-500"
          onClick={() => handleCalendarNavigation("prev")}
          aria-label="Previous month"
        >
          <ChevronLeftIcon className="size-4" />
        </Button>
        <Button
          variant="secondary"
          className="border-r px-3 py-2 text-sm font-semibold text-color-700"
          onClick={() => handleCalendarNavigation("today")}
          tooltip={"Go to today"}
        >
          Today
        </Button>
        <Button
          variant="secondary"
          className="p-[0.7em] text-color-500"
          onClick={() => handleCalendarNavigation("next")}
          aria-label="Next month"
        >
          <ChevronRightIcon className="size-4" />
        </Button>
      </ButtonGroup>
    </div>
  );
}
