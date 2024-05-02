import { useState } from "react";
import dayGridPlugin from "@fullcalendar/daygrid";
import FullCalendar from "@fullcalendar/react";
import type { LoaderFunctionArgs, MetaFunction } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Link } from "@remix-run/react";
import Header from "~/components/layout/header";
import calendarStyles from "~/styles/layout/calendar.css?url";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";
import { getStatusClass } from "~/utils/calendar";
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

    return json(data({ header }));
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
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      <Header hidePageDescription={true} />
      <div className="mt-4">
        {/* @TODO this needs to be further tested */}
        {error && (
          <div className="relative rounded border border-red-400 bg-red-100 px-4 py-3 text-red-700">
            {error}
          </div>
        )}
        <FullCalendar
          plugins={[dayGridPlugin]}
          firstDay={1}
          timeZone="local"
          events={{
            url: "/calendar/events",
            method: "GET",
            format: "json",
            failure: function (error) {
              setError(error.message);
            },
          }}
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
