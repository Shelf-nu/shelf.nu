import dayGridPlugin from "@fullcalendar/daygrid";
import FullCalendar from "@fullcalendar/react";
import { OrganizationRoles } from "@prisma/client";
import type { LoaderFunctionArgs, MetaFunction } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, useSearchParams, Link } from "@remix-run/react";
import Header from "~/components/layout/header";
import { getBookingsForCalendar } from "~/modules/booking/service.server";
import calendarStyles from "~/styles/layout/calendar.css?url";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";
import { getStatusClass } from "~/utils/calendar";
import { makeShelfError } from "~/utils/error";
import { error } from "~/utils/http.server";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.validator.server";
import { requirePermission } from "~/utils/roles.server";
import { useRef, useState } from "react";
import {format} from "date-fns";
import { ChevronLeftIcon, ChevronRightIcon } from "@radix-ui/react-icons";

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
    const { organizationId, role } = await requirePermission({
      userId: authSession.userId,
      request,
      entity: PermissionEntity.booking,
      action: PermissionAction.read,
    });
    const isSelfService = role === OrganizationRoles.SELF_SERVICE;

    const calendarEvents = await getBookingsForCalendar({
      request,
      organizationId,
      userId,
      isSelfService,
    });

    const header = {
      title: `Calendar`,
    };

    return json({ header, calendarEvents });
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
  const { calendarEvents } = useLoaderData<typeof loader>();
  const [_, setSearchParams] = useSearchParams();
  const [title, setTitle] = useState("");
  const handleMonthChange = (info: any) => {
    const newMonth = !(info.start.getDate() == 1)
      ? info.start.getMonth() + 1
      : info.start.getMonth();
    const newYear = info.start.getFullYear();
    const date = new Date(newYear, newMonth);
    setTitle(`${format(date, "MMMM")} ${newYear}`)
    setSearchParams({
      month: (newMonth + 1).toString(),
      year: newYear.toString(),
    });
  };

  const calendarRef = useRef<FullCalendar>(null);

  const handleNext = () => {
    const calendarApi = calendarRef.current?.getApi();
    calendarApi?.next();
  };

  const handlePrev = () => {
    const calendarApi = calendarRef.current?.getApi();
    console.log(calendarRef.current);
    
    calendarApi?.prev();
  };
  const handleGoToCurrentDate = () => {

  }
  return (
    <>
      <Header hidePageDescription={true} />
      <div className="mt-4">
        <div className="border border-[#EAECF0] px-4 py-3 gap-4 flex justify-between items-center rounded-t-md">
          <div className="text-[#101828] font-sans text-lg font-semibold leading-[20px] text-left">{title}</div>
          <div className="flex border border-[#D0D5DD] rounded gap-0 shadow-sm">
            <button className="border-r border-[#D0D5DD] p-2 gap-2 text-[#667085]" onClick={handlePrev}><ChevronLeftIcon/></button>
            <div className="border-r border-[#D0D5DD] px-3 py-2 text-[#344054] font-sans text-sm font-semibold leading-[20px] text-left cursor-pointer" onClick={handleGoToCurrentDate}>Today</div>
            <button className="p-2 gap-2 text-[#667085]" onClick={handleNext}><ChevronRightIcon/></button>
          </div>
        </div>
        <FullCalendar
          ref={calendarRef}
          plugins={[dayGridPlugin]}
          firstDay={1}
          headerToolbar={false}
          timeZone="local"
          events={calendarEvents}
          datesSet={handleMonthChange}
          eventClassNames={(info) => {
            const eventClass = getStatusClass(info.event.extendedProps.status);
            return [eventClass];
          }}
        />
      </div>
    </>
  );
};

export default Calendar;
