import { useState, useEffect } from "react";
import dayGridPlugin from "@fullcalendar/daygrid";
import FullCalendar from "@fullcalendar/react";
import type { LoaderFunctionArgs, MetaFunction } from "@remix-run/node";
import { json } from "@remix-run/node";
import {
  useLoaderData,
  useNavigate,
  useSearchParams,
  Link,
} from "@remix-run/react";
import Header from "~/components/layout/header";
import calendarStyles from "~/styles/layout/calendar.css?url";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";
import { makeShelfError } from "~/utils/error";
import { error } from "~/utils/http.server";
const dummyOrganizationId = "shelf";
const dummyUserId = "shelfnu";

// Create dummy bookings
const dummyBookings = [
  {
    id: "booking-1",
    name: "January Booking 1",
    from: new Date("2024-01-05T08:00:00"), // Including time
    to: new Date("2024-01-10"),
    status: "CONFIRMED",
    creatorId: "user-1",
    custodian: "John Doe", // Adding custodian name
  },
  {
    id: "booking-2",
    name: "January Booking 2",
    from: new Date("2024-01-15T09:30:00"), // Example starting time
    to: new Date("2024-01-20"),
    status: "DRAFT",
    creatorId: "user-2",
    custodian: "Jane Smith", // Adding custodian name
  },
  {
    id: "booking-3",
    name: "February Booking 1",
    from: new Date("2024-02-05T10:00:00"),
    to: new Date("2024-02-10"),
    status: "CONFIRMED",
    creatorId: "user-3",
    custodian: "Michael Johnson",
  },
  {
    id: "booking-4",
    name: "February Booking 2",
    from: new Date("2024-02-15T11:00:00"),
    to: new Date("2024-02-20"),
    status: "CANCELLED",
    creatorId: "user-4",
    custodian: "Emily Brown",
  },
  {
    id: "booking-5",
    name: "March Booking 1",
    from: new Date("2024-03-05T12:00:00"),
    to: new Date("2024-03-10"),
    status: "CONFIRMED",
    creatorId: "user-5",
    custodian: "Daniel White",
  },
  {
    id: "booking-6",
    name: "March Booking 2",
    from: new Date("2024-03-15T13:00:00"),
    to: new Date("2024-03-20"),
    status: "CONFIRMED",
    creatorId: "user-6",
    custodian: "Sophia Lee",
  },
  {
    id: "booking-7",
    name: "April Booking 1",
    from: new Date("2024-04-05T14:00:00"),
    to: new Date("2024-04-10"),
    status: "RESERVED",
    creatorId: "user-6",
    custodian: "Olivia Taylor",
  },
  {
    id: "booking-8",
    name: "April Booking 2",
    from: new Date("2024-04-15T15:00:00"),
    to: new Date("2024-04-20"),
    status: "COMPLETED",
    creatorId: "user-7",
    custodian: "William Davis",
  },
];

const getStatusClass = (status:any) => {
  console.log(status)
  
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
// As per the DB Model
const dummyBookingsResponse = {
  bookings: dummyBookings,
  bookingCount: dummyBookings.length,
  page: 1,
  perPage: 2,
  search: null,
  organizationId: dummyOrganizationId,
  userId: dummyUserId,
};

export function links() {
  return [{ rel: "stylesheet", href: calendarStyles }];
}

export const handle = {
  breadcrumb: () => <Link to="/calendar">Calendar</Link>,
};

const formatTime = (date: any) =>
  date.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "numeric",
    hour12: true,
    meridiem: false,
  });

// Loader Function to Return Bookings Data
export const loader = ({ request }: LoaderFunctionArgs) => {
  try {
    const url = new URL(request.url);
    const monthParam = url.searchParams.get("month");
    const yearParam = url.searchParams.get("year");

    const currentMonth = monthParam
      ? parseInt(monthParam, 10) - 1
      : new Date().getMonth() + 1;

    const currentYear = yearParam
      ? parseInt(yearParam, 10)
      : new Date().getFullYear();

    const calendarEvents = dummyBookings
      .filter(
        (booking) =>
          booking.from.getMonth() === currentMonth &&
          booking.from.getFullYear() === currentYear
      )
      .map((booking) => ({
        title: `${formatTime(booking.from)} | ${booking.name} | ${
          booking.custodian
        }`,
        start: booking.from.toISOString(),
        end: booking.to.toISOString(),
        extendedProps: {
          status: booking.status,
        }
      }));

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
  const { header, calendarEvents } = useLoaderData<typeof loader>();
  const [searchParams, setSearchParams] = useSearchParams();

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
