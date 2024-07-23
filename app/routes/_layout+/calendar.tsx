import { useState, useRef, useCallback } from "react";
import type { EventHoveringArg } from "@fullcalendar/core/index.js";
import dayGridPlugin from "@fullcalendar/daygrid";
import listPlugin from "@fullcalendar/list";
import FullCalendar from "@fullcalendar/react";
import type { BookingStatus } from "@prisma/client";
import { HoverCardPortal } from "@radix-ui/react-hover-card";
import { ChevronLeftIcon, ChevronRightIcon } from "@radix-ui/react-icons";
import type { LoaderFunctionArgs, MetaFunction } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Link, useLoaderData } from "@remix-run/react";
import { format } from "date-fns";
import { ClientOnly } from "remix-utils/client-only";
import FallbackLoading from "~/components/dashboard/fallback-loading";
import { ArrowRightIcon } from "~/components/icons/library";
import Header from "~/components/layout/header";
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
import { UserBadge } from "~/components/shared/user-badge";
import { useViewportHeight } from "~/hooks/use-viewport-height";
import calendarStyles from "~/styles/layout/calendar.css?url";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";
import { statusClassesOnHover } from "~/utils/calendar";
import { getWeekStartingAndEndingDates } from "~/utils/date-fns";
import { makeShelfError } from "~/utils/error";
import { data, error } from "~/utils/http.server";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.validator.server";
import { requirePermission } from "~/utils/roles.server";
import { bookingStatusColorMap } from "./bookings";

export function links() {
  return [{ rel: "stylesheet", href: calendarStyles }];
}

export const handle = {
  breadcrumb: () => <Link to="/calendar">Calendar</Link>,
};

type CalendarExtendedProps = {
  id: string;
  status: BookingStatus;
  name: string;
  description: string | null;
  start: string;
  end: string;
  custodian: {
    name: string;
    image?: string | null;
  };
};

// Loader Function to Return Bookings Data
export const loader = async ({ request, context }: LoaderFunctionArgs) => {
  const authSession = context.getSession();
  const { userId } = authSession;

  try {
    await requirePermission({
      userId,
      request,
      entity: PermissionEntity.booking,
      action: PermissionAction.read,
    });

    const header = {
      title: `Calendar`,
    };

    const currentDate = new Date();
    const currentMonth = currentDate.toLocaleString("default", {
      month: "long",
    });
    const currentYear = currentDate.getFullYear();

    const title = `${currentMonth} ${currentYear}`;

    return json(data({ header, title }));
  } catch (cause) {
    const reason = makeShelfError(cause);
    throw json(error(reason), { status: reason.status });
  }
};
export const meta: MetaFunction<typeof loader> = ({ data }) => [
  { title: appendToMetaTitle(data?.header.title) },
];

export const DATE_FORMAT_OPTIONS = {
  weekday: "short",
  hour: "2-digit",
  minute: "2-digit",
} as const;

// Calendar Component
const Calendar = () => {
  const { title } = useLoaderData<typeof loader>();
  const { isMd } = useViewportHeight();
  const [startingDay, endingDay] = getWeekStartingAndEndingDates(new Date());
  const [_error, setError] = useState<string | null>(null);
  const [calendarTitle, setCalendarTitle] = useState(title);
  const [calendarSubtitle, setCalendarSubtitle] = useState(
    isMd ? undefined : `${startingDay} - ${endingDay}`
  );

  const calendarRef = useRef<FullCalendar>(null);
  const ripple = useRef<HTMLDivElement>(null);

  const handleNavigation = (navigateTo: "prev" | "today" | "next") => {
    const calendarApi = calendarRef.current?.getApi();
    if (navigateTo == "prev") {
      calendarApi?.prev();
    } else if (navigateTo == "next") {
      calendarApi?.next();
    } else if (navigateTo == "today") {
      calendarApi?.gotoDate(new Date());
    }
    updateTitle();
  };

  const updateTitle = () => {
    const calendarApi = calendarRef.current?.getApi();
    if (calendarApi) {
      const currentDate = calendarApi.getDate();
      const currentMonth = currentDate.toLocaleString("default", {
        month: "long",
      });
      const currentYear = currentDate.getFullYear();
      const [startingDay, endingDay] =
        getWeekStartingAndEndingDates(currentDate);

      setCalendarTitle(`${currentMonth} ${currentYear}`);
      setCalendarSubtitle(`${startingDay} - ${endingDay}`);
    }
  };

  const toggleSpinner = useCallback(
    (state: any) => {
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

  const handleEventMouseEnter = (info: EventHoveringArg) => {
    const statusClass: BookingStatus = info.event._def.extendedProps.status;
    const className = "bookingId-" + info.event._def.extendedProps.id;
    const elements = document.getElementsByClassName(className);
    for (let i = 0; i < elements.length; i++) {
      const element = elements[i] as HTMLElement;
      element.classList.add(statusClassesOnHover[statusClass]);
    }
  };

  const handleEventMouseLeave = (info: EventHoveringArg) => {
    const statusClass: BookingStatus = info.event._def.extendedProps.status;
    const className = "bookingId-" + info.event._def.extendedProps.id;
    const elements = document.getElementsByClassName(className);
    for (let i = 0; i < elements.length; i++) {
      const element = elements[i] as HTMLElement;
      element.classList.remove(statusClassesOnHover[statusClass]);
    }
  };

  const handleWindowResize = () => {
    const calendar = calendarRef?.current?.getApi();
    if (calendar) {
      calendar.changeView(isMd ? "dayGridMonth" : "listWeek");
    }
  };

  return (
    <>
      <Header hidePageDescription={true} />
      <div className="mt-4">
        <div className="flex items-center justify-between gap-4 rounded-t-md border bg-white px-4 py-3">
          <div>
            <div className="text-left font-sans text-lg font-semibold leading-[20px] ">
              {calendarTitle}
            </div>
            {!isMd ? (
              <div className="text-gray-600">{calendarSubtitle}</div>
            ) : null}
          </div>

          <div className="flex items-center">
            <div ref={ripple} className="mr-3 flex justify-center">
              <Spinner />
            </div>
            <ButtonGroup>
              <Button
                variant="secondary"
                className="border-r p-[0.75em] text-gray-500"
                onClick={() => handleNavigation("prev")}
              >
                <ChevronLeftIcon />
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
                className="p-[0.75em] text-gray-500"
                onClick={() => handleNavigation("next")}
              >
                <ChevronRightIcon />
              </Button>
            </ButtonGroup>
          </div>
        </div>
        <ClientOnly fallback={<FallbackLoading className="size-[150px]" />}>
          {() => (
            <FullCalendar
              ref={calendarRef}
              plugins={[dayGridPlugin, listPlugin]}
              initialView={isMd ? "dayGridMonth" : "listWeek"}
              firstDay={1}
              timeZone="local"
              headerToolbar={false}
              events={{
                url: "/calendar/events",
                method: "GET",
                failure: (err) => setError(err.message),
              }}
              dayMaxEvents={4}
              moreLinkClick="popover"
              eventMouseEnter={handleEventMouseEnter}
              eventMouseLeave={handleEventMouseLeave}
              windowResize={handleWindowResize}
              eventContent={(args) => {
                const hoveredBooking = args.event
                  .extendedProps as CalendarExtendedProps;

                const startTime = format(
                  new Date(hoveredBooking.start),
                  "hh:mm"
                );

                return (
                  <HoverCard openDelay={0} closeDelay={0}>
                    <HoverCardTrigger className="inline-block w-full truncate">
                      {startTime} | {args.event.title}
                    </HoverCardTrigger>

                    <HoverCardPortal>
                      <HoverCardContent
                        className="pointer-events-none md:w-96"
                        side="top"
                      >
                        <div className="flex w-full items-center gap-x-2 text-xs text-gray-600">
                          <DateS
                            date={hoveredBooking.start}
                            options={DATE_FORMAT_OPTIONS}
                          />
                          <ArrowRightIcon className="size-3 text-gray-600" />
                          <DateS
                            date={hoveredBooking.end}
                            options={DATE_FORMAT_OPTIONS}
                          />
                        </div>

                        <p className="mb-3 text-sm font-medium">
                          {hoveredBooking.name}
                        </p>

                        <div className="mb-3 flex items-center gap-2">
                          <Badge
                            color={bookingStatusColorMap[hoveredBooking.status]}
                          >
                            <span className="block lowercase first-letter:uppercase">
                              {hoveredBooking.status}
                            </span>
                          </Badge>

                          <UserBadge
                            imgClassName="rounded-full"
                            name={hoveredBooking.custodian.name}
                            img={
                              hoveredBooking?.custodian.image ??
                              "/static/images/default_pfp.jpg"
                            }
                          />
                        </div>

                        {hoveredBooking.description ? (
                          <div className="wordwrap rounded border border-gray-200 bg-gray-25 p-2 text-gray-500">
                            {hoveredBooking.description}
                          </div>
                        ) : null}
                      </HoverCardContent>
                    </HoverCardPortal>
                  </HoverCard>
                );
              }}
              eventTimeFormat={{
                hour: "numeric",
                minute: "2-digit",
                meridiem: "short",
              }}
              height="auto"
              loading={toggleSpinner}
            />
          )}
        </ClientOnly>
      </div>
    </>
  );
};

export default Calendar;
