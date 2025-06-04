import { useCallback, useMemo, useRef, useState } from "react";
import type { EventContentArg } from "@fullcalendar/core";
import FullCalendar from "@fullcalendar/react";
import resourceTimelinePlugin from "@fullcalendar/resource-timeline";
import type { BookingStatus } from "@prisma/client";
import { HoverCardPortal } from "@radix-ui/react-hover-card";
import { useLoaderData } from "@remix-run/react";
import {
  ArrowRightIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
} from "lucide-react";
import { ClientOnly } from "remix-utils/client-only";
import FallbackLoading from "~/components/dashboard/fallback-loading";
import { Badge } from "~/components/shared/badge";
import { Button } from "~/components/shared/button";
import { ButtonGroup } from "~/components/shared/button-group";
import { DateS } from "~/components/shared/date";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "~/components/shared/hover-card";
import { Spinner } from "~/components/shared/spinner";
import { useViewportHeight } from "~/hooks/use-viewport-height";
import type { AssetIndexLoaderData } from "~/routes/_layout+/assets._index";
import { DATE_FORMAT_OPTIONS } from "~/routes/_layout+/calendar";
import { bookingStatusColorMap } from "~/utils/bookings";
import { FULL_CALENDAR_LICENSE_KEY } from "~/utils/env";
import { tw } from "~/utils/tw";

export default function AssetsAvailability() {
  const { items } = useLoaderData<AssetIndexLoaderData>();
  const calendarRef = useRef<FullCalendar>(null);
  const ripple = useRef<HTMLDivElement>(null);
  const { isMd } = useViewportHeight();
  const [calendarView, setCalendarView] = useState(
    isMd ? "resourceTimelineMonth" : "resourceTimelineWeek"
  );

  const disabledButtonStyles =
    "cursor-not-allowed pointer-events-none bg-gray-50 text-gray-800";

  const { resources, events } = useMemo(() => {
    const resources = items.map((item) => ({ id: item.id, title: item.title }));

    const events = items
      .map((asset) => [
        ...asset.bookings.map((b) => ({
          title: b.name,
          resourceId: asset.id,
          start: b.from!,
          end: b.to!,
          extendedProps: {
            id: b.id,
            status: b.status,
            title: b.name,
            description: b.description,
            start: b.from,
            end: b.to,
          },
        })),
      ])
      .flat();

    return { resources, events };
  }, [items]);

  const toggleLoader = useCallback(
    (state: boolean) => {
      if (ripple.current) {
        if (state) {
          ripple.current.classList.remove("hidden");
        } else {
          ripple.current.classList.add("hidden");
        }
      }
    },
    [ripple]
  );

  const handleNavigation = (navigateTo: "prev" | "today" | "next") => {
    const calendarApi = calendarRef.current?.getApi();
    if (navigateTo == "prev") {
      calendarApi?.prev();
    } else if (navigateTo == "next") {
      calendarApi?.next();
    } else if (navigateTo == "today") {
      calendarApi?.gotoDate(new Date());
    }
  };

  const handleViewChange = (view: string) => {
    setCalendarView(view);
    const calendarApi = calendarRef.current?.getApi();
    calendarApi?.changeView(view);
  };

  return (
    <div>
      <div className="flex items-center justify-between gap-4 rounded-t-md border bg-white px-4 py-3">
        <div className="flex items-center gap-2">
          <h3>{calendarRef?.current?.getApi()?.view.title}</h3>

          <div ref={ripple} className="mr-3 flex justify-center">
            <Spinner />
          </div>
        </div>

        <div className="flex items-center">
          <div className="mr-4">
            <ButtonGroup>
              <Button
                variant="secondary"
                className="border-r p-[0.7em] text-gray-500"
                onClick={() => handleNavigation("prev")}
                aria-label="Previous month"
              >
                <ChevronLeftIcon className="size-4" />
              </Button>
              <Button
                variant="secondary"
                className="border-r px-3 py-2 text-sm font-semibold text-gray-700"
                onClick={() => handleNavigation("today")}
              >
                Today
              </Button>
              <Button
                variant="secondary"
                className="p-[0.7em] text-gray-500"
                onClick={() => handleNavigation("next")}
                aria-label="Next month"
              >
                <ChevronRightIcon className="size-4" />
              </Button>
            </ButtonGroup>
          </div>

          {isMd ? (
            <ButtonGroup>
              <Button
                variant="secondary"
                onClick={() => handleViewChange("resourceTimelineMonth")}
                className={tw(
                  calendarView === "resourceTimelineMonth"
                    ? `${disabledButtonStyles}`
                    : ""
                )}
              >
                Month
              </Button>
              <Button
                variant="secondary"
                onClick={() => handleViewChange("resourceTimelineWeek")}
                className={tw(
                  calendarView === "resourceTimelineWeek"
                    ? `${disabledButtonStyles}`
                    : ""
                )}
              >
                Week
              </Button>
              <Button
                variant="secondary"
                onClick={() => handleViewChange("resourceTimelineDay")}
                className={tw(
                  calendarView === "resourceTimelineDay"
                    ? `${disabledButtonStyles}`
                    : ""
                )}
              >
                Day
              </Button>
            </ButtonGroup>
          ) : null}
        </div>
      </div>

      <ClientOnly fallback={<FallbackLoading className="size-36" />}>
        {() => (
          <FullCalendar
            ref={calendarRef}
            height="auto"
            timeZone="local"
            slotEventOverlap
            eventTimeFormat={{
              hour: "numeric",
              minute: "2-digit",
              meridiem: "short",
            }}
            plugins={[resourceTimelinePlugin]}
            schedulerLicenseKey={FULL_CALENDAR_LICENSE_KEY}
            initialView="resourceTimelineMonth"
            headerToolbar={false}
            resources={resources}
            events={events}
            resourceAreaHeaderContent="Assets"
            resourceLabelContent={({ resource }) => (
              <div className="p-2">{resource.title}</div>
            )}
            eventContent={EventCard}
            eventClassNames="cursor-pointer border border-primary-500 bg-primary-50 rounded px-2"
            loading={toggleLoader}
          />
        )}
      </ClientOnly>
    </div>
  );
}

function EventCard(args: EventContentArg) {
  const event = args.event;
  const booking = args.event.extendedProps;

  return (
    <HoverCard openDelay={0} closeDelay={0}>
      <HoverCardTrigger asChild>
        <div className="text-primary-700">
          {args.timeText} | {event.title}
        </div>
      </HoverCardTrigger>

      <HoverCardPortal>
        <HoverCardContent
          className="pointer-events-none z-[99999] md:w-96"
          side="top"
          align="start"
        >
          <div className="flex w-full items-center gap-x-2 text-xs text-gray-600">
            <DateS date={booking.start} options={DATE_FORMAT_OPTIONS} />
            <ArrowRightIcon className="size-3 text-gray-600" />
            <DateS date={booking.end} options={DATE_FORMAT_OPTIONS} />
          </div>

          <div className="mb-3 mt-1 text-sm font-medium">{booking.title}</div>

          <div className="mb-3 flex items-center gap-2">
            <Badge
              color={bookingStatusColorMap[booking.status as BookingStatus]}
            >
              <span className="block whitespace-nowrap lowercase first-letter:uppercase">
                {booking.status}
              </span>
            </Badge>
          </div>

          {booking.description ? (
            <div className="wordwrap rounded border border-gray-200 bg-gray-25 p-2 text-gray-500">
              {booking.description}
            </div>
          ) : null}
        </HoverCardContent>
      </HoverCardPortal>
    </HoverCard>
  );
}
