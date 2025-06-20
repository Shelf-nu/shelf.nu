import { useState, useRef, useCallback } from "react";
import dayGridPlugin from "@fullcalendar/daygrid";
import listPlugin from "@fullcalendar/list";
import FullCalendar from "@fullcalendar/react";
import timeGridPlugin from "@fullcalendar/timegrid";
import type { BookingStatus } from "@prisma/client";
import type { LoaderFunctionArgs, MetaFunction } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Link } from "@remix-run/react";
import { ClientOnly } from "remix-utils/client-only";
import CreateBookingDialog from "~/components/booking/create-booking-dialog";

import { CalendarNavigation } from "~/components/calendar/calendar-navigation";
import renderEventCard from "~/components/calendar/event-card";
import TitleContainer from "~/components/calendar/title-container";
import { ViewButtonGroup } from "~/components/calendar/view-button-group";
import FallbackLoading from "~/components/dashboard/fallback-loading";
import { ErrorContent } from "~/components/errors";
import Header from "~/components/layout/header";
import { Button } from "~/components/shared/button";
import { Spinner } from "~/components/shared/spinner";
import type { TeamMemberForBadge } from "~/components/user/team-member-badge";
import { db } from "~/database/db.server";
import { hasGetAllValue } from "~/hooks/use-model-filters";
import { useViewportHeight } from "~/hooks/use-viewport-height";
import { getTeamMemberForCustodianFilter } from "~/modules/team-member/service.server";
import calendarStyles from "~/styles/layout/calendar.css?url";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";
import {
  getCalendarTitleAndSubtitle,
  getStatusClasses,
  handleEventClick,
  handleEventMouseEnter,
  handleEventMouseLeave,
  isOneDayEvent,
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

export function links() {
  return [{ rel: "stylesheet", href: calendarStyles }];
}

export const handle = {
  breadcrumb: () => <Link to="/calendar">Calendar</Link>,
};

export type CalendarExtendedProps = {
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

    const searchParams = getCurrentSearchParams(request);
    const { teamMemberIds } = getParamsValues(searchParams);

    const [teamMembersData, tags] = await Promise.all([
      getTeamMemberForCustodianFilter({
        organizationId,
        selectedTeamMembers: teamMemberIds,
        getAll:
          searchParams.has("getAll") &&
          hasGetAllValue(searchParams, "teamMember"),
        filterByUserId: isSelfServiceOrBase, // We only need teamMembersData for the new booking dialog, so if the user is self service or base, we dont need to load other teamMembers
        userId,
      }),

      db.tag.findMany({ where: { organizationId } }),
    ]);

    return json(
      data({
        header,
        ...teamMembersData,
        currentOrganization,
        tags,
        totalTags: tags.length,
      })
    );
  } catch (cause) {
    const reason = makeShelfError(cause);
    throw json(error(reason), { status: reason.status });
  }
};
export const meta: MetaFunction<typeof loader> = ({ data }) => [
  { title: appendToMetaTitle(data?.header.title) },
];

// Calendar Component
export default function Calendar() {
  const { isMd } = useViewportHeight();
  const [startingDay, endingDay] = getWeekStartingAndEndingDates(new Date());
  const [_error, setError] = useState<string | null>(null);

  const [calendarHeader, setCalendarHeader] = useState<{
    title?: string;
    subtitle?: string;
  }>({
    title: "",
    subtitle: isMd ? undefined : `${startingDay} - ${endingDay}`,
  });

  const [calendarView, setCalendarView] = useState(
    isMd ? "dayGridMonth" : "listWeek"
  );

  const calendarRef = useRef<FullCalendar>(null);
  const ripple = useRef<HTMLDivElement>(null);

  function updateTitle(viewType = calendarView) {
    const calendarApi = calendarRef.current?.getApi();
    if (calendarApi) {
      setCalendarHeader(getCalendarTitleAndSubtitle({ viewType, calendarApi }));
    }
  }

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
              calendarTitle={calendarHeader.title}
              calendarSubtitle={calendarHeader.subtitle}
              calendarView={calendarView}
            />
            <div ref={ripple} className="mr-3 flex justify-center">
              <Spinner />
            </div>
          </div>

          <div className="flex items-center">
            <CalendarNavigation
              calendarRef={calendarRef}
              updateTitle={() => updateTitle(calendarView)}
            />

            {isMd ? (
              <ViewButtonGroup
                views={[
                  { label: "Month", value: "dayGridMonth" },
                  { label: "Week", value: "timeGridWeek" },
                  { label: "Day", value: "timeGridDay" },
                ]}
                currentView={calendarView}
                onViewChange={handleViewChange}
              />
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
              nowIndicator
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
              eventMouseEnter={handleEventMouseEnter("dayGridMonth")}
              eventMouseLeave={handleEventMouseLeave("dayGridMonth")}
              eventClick={handleEventClick}
              windowResize={handleWindowResize}
              eventContent={renderEventCard}
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

export const ErrorBoundary = () => <ErrorContent />;
