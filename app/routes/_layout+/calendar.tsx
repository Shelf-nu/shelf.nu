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
import { makeShelfError } from "~/utils/error";
import { error } from "~/utils/http.server";
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

const getStatusClass = (status: any) => {
  switch (status) {
    case "CONFIRMED":
      return "ongoing";
    case "COMPLETED":
      return "completed";
    case "RESERVED":
      return "reserved";
    case "DRAFT":
      return "draft";
    default:
      return "";
  }
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

  const handleMonthChange = (info: any) => {
    const newMonth = !(info.start.getDate() == 1)
      ? info.start.getMonth() + 1
      : info.start.getMonth();
    const newYear = info.start.getFullYear();
    setSearchParams({
      month: (newMonth + 1).toString(),
      year: newYear.toString(),
    });
  };

  return (
    <>
      <Header hidePageDescription={true} />
      <div className="mt-4">
        <FullCalendar
          plugins={[dayGridPlugin]}
          firstDay={1}
          headerToolbar={{
            start: "title",
            center: "",
            end: "prev today next",
          }}
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
