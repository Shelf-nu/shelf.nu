import { useState, useRef, useCallback } from "react";
import type {
  EventContentArg,
  EventHoveringArg,
} from "@fullcalendar/core/index.js";
import dayGridPlugin from "@fullcalendar/daygrid";
import listPlugin from "@fullcalendar/list";
import FullCalendar from "@fullcalendar/react";
import timeGridPlugin from "@fullcalendar/timegrid";
import type { BookingStatus } from "@prisma/client";
import { HoverCardPortal } from "@radix-ui/react-hover-card";
import { ChevronLeftIcon, ChevronRightIcon } from "@radix-ui/react-icons";
import type { LoaderFunctionArgs, MetaFunction } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Link } from "@remix-run/react";
import { ClientOnly } from "remix-utils/client-only";
import { BookingStatusBadge } from "~/components/booking/booking-status-badge";
import CreateBookingDialog from "~/components/booking/create-booking-dialog";
import TitleContainer from "~/components/calendar/title-container";
import FallbackLoading from "~/components/dashboard/fallback-loading";
import { ErrorContent } from "~/components/errors";
import { ArrowRightIcon } from "~/components/icons/library";
import Header from "~/components/layout/header";
import { Button } from "~/components/shared/button";
import { ButtonGroup } from "~/components/shared/button-group";
import { DateS } from "~/components/shared/date";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "~/components/shared/hover-card";
import { Spinner } from "~/components/shared/spinner";
import { TeamMemberBadge } from "~/components/user/team-member-badge";
import type { TeamMemberForBadge } from "~/components/user/team-member-badge";
import When from "~/components/when/when";
import { hasGetAllValue } from "~/hooks/use-model-filters";
import { useViewportHeight } from "~/hooks/use-viewport-height";
import { getTeamMemberForCustodianFilter } from "~/modules/team-member/service.server";
import calendarStyles from "~/styles/layout/calendar.css?url";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";
import {
  getStatusClasses,
  isOneDayEvent,
  statusClassesOnHover,
} from "~/utils/calendar";
import { getWeekStartingAndEndingDates } from "~/utils/date-fns";
import { makeShelfError, ShelfError } from "~/utils/error";
import { data, error, getCurrentSearchParams } from "~/utils/http.server";
import { getParamsValues } from "~/utils/list";
import { isPersonalOrg } from "~/utils/organization";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { requirePermission } from "~/utils/roles.server";
import { tw } from "~/utils/tw";

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
  custodian: TeamMemberForBadge;
};

// Loader Function to Return Bookings Data
export const loader = async ({ request, context }: LoaderFunctionArgs) => {
  const authSession = context.getSession();
  const { userId } = authSession;

  try {
    const { isSelfServiceOrBase, currentOrganization, organizationId } =
      await requirePermission({
        userId,
        request,
        entity: PermissionEntity.booking,
        action: PermissionAction.read,
      });

    if (isPersonalOrg(currentOrganization)) {
      throw new ShelfError({
        cause: null,
        title: "Not allowed",
        message:
          "You cannot use bookings in a personal workspaces. Please create a Team workspace to create bookings.",
        label: "Booking",
        shouldBeCaptured: false,
      });
    }

    const header = {
      title: `Calendar`,
    };

    const currentDate = new Date();
    const currentMonth = currentDate.toLocaleString("default", {
      month: "long",
    });
    const currentYear = currentDate.getFullYear();

    const title = `${currentMonth} ${currentYear}`;

    const searchParams = getCurrentSearchParams(request);
    const { teamMemberIds } = getParamsValues(searchParams);

    const teamMembersData = await getTeamMemberForCustodianFilter({
      organizationId,
      selectedTeamMembers: teamMemberIds,
      getAll:
        searchParams.has("getAll") &&
        hasGetAllValue(searchParams, "teamMember"),
      filterByUserId: isSelfServiceOrBase, // We only need teamMembersData for the new booking dialog, so if the user is self service or base, we dont need to load other teamMembers
      userId,
    });

    return json(
      data({ header, title, ...teamMembersData, currentOrganization })
    );
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
export default function Calendar() {
  const { isMd } = useViewportHeight();
  const [startingDay, endingDay] = getWeekStartingAndEndingDates(new Date());
  const [_error, setError] = useState<string | null>(null);
  const [calendarTitle, setCalendarTitle] = useState<string>();
  const [calendarSubtitle, setCalendarSubtitle] = useState(
    isMd ? undefined : `${startingDay} - ${endingDay}`
  );
  const [calendarView, setCalendarView] = useState(
    isMd ? "dayGridMonth" : "listWeek"
  );
  const disabledButtonStyles =
    "cursor-not-allowed pointer-events-none bg-gray-50 text-gray-800";
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

  const updateTitle = (viewMode = calendarView) => {
    const calendarApi = calendarRef.current?.getApi();
    if (calendarApi) {
      const currentDate = calendarApi.getDate();
      const currentMonth = currentDate.toLocaleString("default", {
        month: "long",
      });
      const currentYear = currentDate.getFullYear();

      let mainTitle = `${currentMonth} ${currentYear}`;
      let subtitle = "";

      if (viewMode === "timeGridWeek") {
        const [startingDay, endingDay] =
          getWeekStartingAndEndingDates(currentDate);
        mainTitle = `${currentMonth} ${currentYear}`;
        subtitle = `Week ${startingDay} - ${endingDay}`;
      } else if (viewMode === "timeGridDay") {
        const formattedDate = currentDate.toLocaleDateString("default", {
          day: "numeric",
          month: "long",
          year: "numeric",
        });
        const weekday = currentDate.toLocaleDateString("default", {
          weekday: "long",
        });
        mainTitle = formattedDate;
        subtitle = weekday;
      }

      setCalendarTitle(mainTitle);
      setCalendarSubtitle(subtitle);
    }
  };

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

  const handleEventMouseEnter = (info: EventHoveringArg) => {
    const viewType = info.view.type;
    if (viewType != "dayGridMonth") return;
    const statusClass: BookingStatus = info.event._def.extendedProps.status;
    const className = "bookingId-" + info.event._def.extendedProps.id;
    const elements = document.getElementsByClassName(className);
    for (let i = 0; i < elements.length; i++) {
      const element = elements[i] as HTMLElement;
      element.classList.add(statusClassesOnHover[statusClass]);
    }
  };

  const handleEventMouseLeave = (info: EventHoveringArg) => {
    const viewType = info.view.type;
    if (viewType != "dayGridMonth") return;
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
      calendar.changeView(isMd ? calendarView : "listWeek");
    }
  };

  const handleViewChange = (view: string) => {
    setCalendarView(view);
    const calendarApi = calendarRef.current?.getApi();
    calendarApi?.changeView(view);
    updateTitle(view);
  };

  const updateViewClasses = (calendarContainer: any, viewType: any) => {
    calendarContainer.classList.remove("month-view", "week-view", "day-view");
    if (viewType === "dayGridMonth") {
      calendarContainer.classList.add("month-view");
    } else if (viewType === "timeGridWeek") {
      calendarContainer.classList.add("week-view");
    } else if (viewType === "timeGridDay") {
      calendarContainer.classList.add("day-view");
    }
  };

  return (
    <>
      <Header hidePageDescription>
        <CreateBookingDialog
          trigger={<Button aria-label="new booking">New booking</Button>}
        />
      </Header>

      <div className="mt-4">
        <div className="flex items-center justify-between gap-4 rounded-t-md border bg-white px-4 py-3">
          <div className="flex items-center gap-2">
            <TitleContainer
              calendarTitle={calendarTitle}
              calendarSubtitle={calendarSubtitle}
              calendarView={calendarView}
            />
            <div ref={ripple} className="mr-3 flex justify-center">
              <Spinner />
            </div>
          </div>

          <div className="flex items-center">
            <div className="mr-4">
              <ButtonGroup>
                <Button
                  variant="secondary"
                  className="border-r p-[0.75em] text-gray-500"
                  onClick={() => handleNavigation("prev")}
                  aria-label="Previous month"
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
                  aria-label="Next month"
                >
                  <ChevronRightIcon />
                </Button>
              </ButtonGroup>
            </div>

            {isMd ? (
              <ButtonGroup>
                <Button
                  variant="secondary"
                  onClick={() => handleViewChange("dayGridMonth")}
                  className={tw(
                    calendarView === "dayGridMonth"
                      ? `${disabledButtonStyles}`
                      : ""
                  )}
                >
                  Month
                </Button>
                <Button
                  variant="secondary"
                  onClick={() => handleViewChange("timeGridWeek")}
                  className={tw(
                    calendarView === "timeGridWeek"
                      ? `${disabledButtonStyles}`
                      : ""
                  )}
                >
                  Week
                </Button>
                <Button
                  variant="secondary"
                  onClick={() => handleViewChange("timeGridDay")}
                  className={tw(
                    calendarView === "timeGridDay"
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
        <ClientOnly fallback={<FallbackLoading className="size-[150px]" />}>
          {() => (
            <FullCalendar
              ref={calendarRef}
              plugins={[dayGridPlugin, listPlugin, timeGridPlugin]}
              initialView={calendarView}
              expandRows={true}
              height="auto"
              firstDay={1}
              timeZone="local"
              headerToolbar={false}
              events={{
                url: "/calendar/events",
                method: "GET",
                failure: (err) => setError(err.message),
              }}
              slotEventOverlap={true}
              dayMaxEvents={3}
              dayMaxEventRows={4}
              moreLinkClick="popover"
              eventMouseEnter={handleEventMouseEnter}
              eventMouseLeave={handleEventMouseLeave}
              windowResize={handleWindowResize}
              eventContent={RenderEventCard}
              eventTimeFormat={{
                hour: "numeric",
                minute: "2-digit",
                meridiem: "short",
              }}
              viewDidMount={(args) => {
                const calendarContainer = args.el;
                const viewType = args.view.type;
                updateViewClasses(calendarContainer, viewType);
              }}
              datesSet={(args) => {
                const calendarContainer = document.querySelector(".fc");
                const viewType = args.view.type;
                updateViewClasses(calendarContainer, viewType);
              }}
              eventClassNames={(eventInfo) => {
                const viewType = eventInfo.view.type;
                const isOneDay = isOneDayEvent(
                  eventInfo.event.start,
                  eventInfo.event.end
                );
                return getStatusClasses(
                  eventInfo.event.extendedProps.status,
                  isOneDay,
                  viewType
                );
              }}
              loading={toggleLoader}
            />
          )}
        </ClientOnly>
      </div>
    </>
  );
}

const RenderEventCard = (args: EventContentArg) => {
  const event = args.event;
  const viewType = event._context.calendarApi.view.type;

  const booking = event.extendedProps as CalendarExtendedProps;
  const _isOneDayEvent = isOneDayEvent(booking.start, booking.end);

  return (
    <HoverCard openDelay={0} closeDelay={0}>
      <HoverCardTrigger asChild>
        <div
          className={tw(
            "inline-block size-full whitespace-normal bg-transparent lg:truncate"
          )}
        >
          {viewType == "dayGridMonth" && (
            <When truthy={_isOneDayEvent}>
              <div className="fc-daygrid-event-dot inline-block" />
            </When>
          )}
          <DateS
            date={booking.start}
            options={{
              timeStyle: "short",
            }}
          />{" "}
          | {event.title}
        </div>
      </HoverCardTrigger>

      <HoverCardPortal>
        <HoverCardContent
          className="pointer-events-none z-[99999] md:w-96"
          side="top"
        >
          <div className="flex w-full items-center gap-x-2 text-xs text-gray-600">
            <DateS date={booking.start} options={DATE_FORMAT_OPTIONS} />
            <ArrowRightIcon className="size-3 text-gray-600" />
            <DateS date={booking.end} options={DATE_FORMAT_OPTIONS} />
          </div>

          <div className="mb-3 mt-1 text-sm font-medium">{booking.name}</div>

          <div className="mb-3 flex items-center gap-2">
            <BookingStatusBadge
              status={booking.status}
              custodianUserId={booking.custodian.user?.id}
            />
            <TeamMemberBadge teamMember={booking.custodian} hidePrivate />
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
};

export const ErrorBoundary = () => <ErrorContent />;
