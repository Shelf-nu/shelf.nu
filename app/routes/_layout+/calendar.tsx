import dayGridPlugin from "@fullcalendar/daygrid";
import FullCalendar from "@fullcalendar/react";
import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, useNavigate } from "@remix-run/react";

const dummyOrganizationId = "shelf";
const dummyUserId = "shelfnu";

// Create dummy bookings
const dummyBookings = [
  {
    id: "booking-1",
    name: "January Booking 1",
    from: new Date("2024-01-05"),
    to: new Date("2024-01-10"),
    status: "CONFIRMED",
    creatorId: "user-1",
  },
  {
    id: "booking-2",
    name: "January Booking 2",
    from: new Date("2024-01-15"),
    to: new Date("2024-01-20"),
    status: "DRAFT",
    creatorId: "user-2",
  },
  {
    id: "booking-3",
    name: "February Booking 1",
    from: new Date("2024-02-05"),
    to: new Date("2024-02-10"),
    status: "CONFIRMED",
    creatorId: "user-3",
  },
  {
    id: "booking-4",
    name: "February Booking 2",
    from: new Date("2024-02-15"),
    to: new Date("2024-02-20"),
    status: "CANCELLED",
    creatorId: "user-4",
  },
  {
    id: "booking-5",
    name: "March Booking 1",
    from: new Date("2024-03-05"),
    to: new Date("2024-03-10"),
    status: "CONFIRMED",
    creatorId: "user-5",
  },
  {
    id: "booking-6",
    name: "March Booking 2",
    from: new Date("2024-03-15"),
    to: new Date("2024-03-20"),
    status: "CONFIRMED",
    creatorId: "user-6",
  },
  {
    id: "booking-5",
    name: "April Booking 1",
    from: new Date("2024-04-05"),
    to: new Date("2024-04-10"),
    status: "CONFIRMED",
    creatorId: "user-6",
  },
  {
    id: "booking-6",
    name: "April Booking 2",
    from: new Date("2024-04-15"),
    to: new Date("2024-04-20"),
    status: "CONFIRMED",
    creatorId: "user-7",
  },
];

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

// Loader Function to Return Bookings Data
export const loader = ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const monthParam = url.searchParams.get("month");
  const yearParam = url.searchParams.get("year");

  const currentMonth = monthParam
    ? parseInt(monthParam, 10) - 1
    : new Date().getMonth() + 1;

  const currentYear = yearParam
    ? parseInt(yearParam, 10)
    : new Date().getFullYear();

  // Filter the bookings for the selected month and year
  const filteredBookings = dummyBookings.filter(
    (booking) =>
      booking.from.getMonth() === currentMonth &&
      booking.from.getFullYear() === currentYear
  );

  const header = {
    title: `Calendar for ${currentMonth + 1}/${currentYear}`,
  };

  return json({ bookings: filteredBookings, header });
};

// Calendar Component
const Calendar = () => {
  const { bookings, header } = useLoaderData<typeof loader>();
  const navigate = useNavigate();

  const calendarEvents = bookings.map((booking) => ({
    title: booking.name,
    start: booking.from,
    end: booking.to,
  }));

  const handleMonthChange = (info: any) => {
    const newMonth = !(info.start.getDate() == 1)
      ? info.start.getMonth() + 1
      : info.start.getMonth();
    const newYear = info.start.getFullYear();
    navigate(`?month=${newMonth + 1}&year=${newYear}`);
  };

  return (
    <>
      <FullCalendar
        plugins={[dayGridPlugin]}
        firstDay={1}
        initialView="dayGridMonth"
        timeZone="local"
        events={calendarEvents}
        datesSet={handleMonthChange}
      />
    </>
  );
};

const calendar = () => <Calendar />;

export default calendar;
