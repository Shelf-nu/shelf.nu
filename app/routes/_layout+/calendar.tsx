import { useState, useRef, useCallback } from "react";
import dayGridPlugin from "@fullcalendar/daygrid";
import FullCalendar from "@fullcalendar/react";
import { ChevronLeftIcon, ChevronRightIcon } from "@radix-ui/react-icons";
import type { LoaderFunctionArgs, MetaFunction } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Link, useLoaderData } from "@remix-run/react";
import { ClientOnly } from "remix-utils/client-only";
import FallbackLoading from "~/components/dashboard/fallback-loading";
import Header from "~/components/layout/header";
import { Button } from "~/components/shared/button";
import { ButtonGroup } from "~/components/shared/button-group";
import { Spinner } from "~/components/shared/spinner";
import calendarStyles from "~/styles/layout/calendar.css?url";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";
import { makeShelfError } from "~/utils/error";
import { data, error } from "~/utils/http.server";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.validator.server";
import { requirePermission } from "~/utils/roles.server";

export function links() {
  return [{ rel: "stylesheet", href: calendarStyles }];
}

export const handle = {
  breadcrumb: () => <Link to="/calendar">Calendar</Link>,
};

// Loader Function to Return Bookings Data
export const loader = async ({ request, context }: LoaderFunctionArgs) => {
  const authSession = context.getSession();
  const { userId } = authSession;

  try {
    // @TODO here we have to handle self-service, and make sure they can only see bookings that belong to them
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

// Calendar Component
const Calendar = () => {
  const { title } = useLoaderData<typeof loader>();
  const [_error, setError] = useState<string | null>(null);
  const [calendarTitle, setCalendarTitle] = useState(title);
  const calendarRef = useRef<FullCalendar>(null);
  const ripple = useRef<HTMLDivElement>(null);

  const handleNavigation = (navigateTo: any) => {
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
      setCalendarTitle(`${currentMonth} ${currentYear}`);
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

  type BookingStatus =
    | "DRAFT"
    | "ARCHIVED"
    | "CANCELLED"
    | "RESERVED"
    | "ONGOING"
    | "OVERDUE"
    | "COMPLETE";

  const statusClassesOnHover: Record<BookingStatus, string> = {
    DRAFT: "#F2F4F7",
    ARCHIVED: "#F2F4F7",
    CANCELLED: "#F2F4F7",
    RESERVED: "#D1E9FF",
    ONGOING: "#EBE9FE",
    OVERDUE: "#FEF0C7",
    COMPLETE: "#DCFAE6",
  };

  const statusClasses: Record<BookingStatus, string> = {
    DRAFT: "#F9FAFB",
    ARCHIVED: "#F9FAFB",
    CANCELLED: "#F9FAFB",
    RESERVED: "#EFF8FF",
    ONGOING: "#F4F3FF",
    OVERDUE: "#FFFAEB",
    COMPLETE: "#ECFDF3",
  };

  const handleEventMouseEnter = (info: any) => {
    const statusClass: BookingStatus = info.event._def.extendedProps.status;
    const className = "bookingId-" + info.event._def.extendedProps.id;
    const elements = document.getElementsByClassName(className);
    for (let i = 0; i < elements.length; i++) {
      const element = elements[i] as HTMLElement;
      element.style.backgroundColor = statusClassesOnHover[statusClass];
    }
  };

  const handleEventMouseLeave = (info: any) => {
    const statusClass: BookingStatus = info.event._def.extendedProps.status;
    const className = "bookingId-" + info.event._def.extendedProps.id;
    const elements = document.getElementsByClassName(className);
    for (let i = 0; i < elements.length; i++) {
      const element = elements[i] as HTMLElement;
      element.style.backgroundColor = statusClasses[statusClass];
    }
  };

  return (
    <>
      <Header hidePageDescription={true} />
      <div className="mt-4">
        <div className="flex items-center justify-between gap-4 rounded-t-md border bg-white px-4 py-3">
          <div className="text-left font-sans text-lg font-semibold leading-[20px] text-[#101828]">
            {calendarTitle}
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
              plugins={[dayGridPlugin]}
              firstDay={1}
              timeZone="local"
              headerToolbar={false}
              events={{
                url: "/calendar/events",
                method: "GET",
                failure: (err) => setError(err.message),
              }}
              eventMouseEnter={handleEventMouseEnter}
              eventMouseLeave={handleEventMouseLeave}
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
