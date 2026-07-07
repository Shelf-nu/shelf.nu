/**
 * Shared calendar event-card renderer tests
 *
 * `renderEventCard` / `EventCardContent` are shared by TWO calendars:
 *   - the availability view (`assets._index`) which sets `slices` /
 *     `sliceCount` / `bookedTotal` on the event's extended props, and
 *   - the main booking calendar (`routes/_layout+/calendar.tsx`) which never
 *     sets them.
 *
 * The feature contract is that the kit glyph and the per-slice "Reserved on
 * this booking" breakdown are gated behind that OPTIONAL availability data, so
 * the booking calendar stays visually unaffected. These tests lock in the
 * gating from both directions: the booking-calendar shape suppresses both
 * surfaces, and the availability shape renders them (ordered standalone-first,
 * pluralized total).
 *
 * @see {@link file://./event-card.tsx}
 */
import type { EventContentArg } from "@fullcalendar/core";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type {
  AvailabilitySlice,
  CalendarExtendedProps,
} from "~/routes/_layout+/calendar";
import renderEventCard, { EventCardContent } from "./event-card";

// why: DateS reads client hints from Remix context unavailable in the test;
// stub to a plain node since date formatting is orthogonal to slice gating.
vi.mock("~/components/shared/date", () => ({
  DateS: () => <span>date</span>,
}));

// why: TeamMemberBadge pulls roles/org/user from Remix loader data; the
// custodian/creator rendering is orthogonal to the breakdown under test.
vi.mock("~/components/user/team-member-badge", () => ({
  TeamMemberBadge: () => <span>member</span>,
}));

// why: BookingStatusBadge reads user data + roles from Remix context; the
// status chip is orthogonal to the slice breakdown/glyph gating.
vi.mock("~/components/booking/booking-status-badge", () => ({
  BookingStatusBadge: () => <span>status</span>,
}));

/** Builds a CalendarExtendedProps booking with sane defaults. Omit
 * `slices`/`sliceCount`/`bookedTotal` to mirror the booking-calendar shape. */
function makeBooking(
  overrides: Partial<CalendarExtendedProps> = {}
): CalendarExtendedProps {
  return {
    id: "b1",
    status: "RESERVED",
    name: "Test Booking",
    description: null,
    start: "2026-07-10T09:00:00.000Z",
    end: "2026-07-11T09:00:00.000Z",
    custodian: { name: "Alice", user: null },
    creator: { name: "Bob", user: null },
    tags: [],
    ...overrides,
  };
}

/** Wraps a booking in the minimal FullCalendar EventContentArg shape that
 * `renderEventCard` reads (view type, title, extendedProps). */
function makeEventArg(booking: CalendarExtendedProps): EventContentArg {
  return {
    event: {
      title: booking.name,
      extendedProps: booking,
      _context: { calendarApi: { view: { type: "resourceTimelineMonth" } } },
    },
  } as unknown as EventContentArg;
}

const STANDALONE: AvailabilitySlice = {
  assetKitId: null,
  kitName: null,
  quantity: 2,
};
const KIT_SLICE: AvailabilitySlice = {
  assetKitId: "ak1",
  kitName: "Camera Kit",
  quantity: 3,
};

describe("EventCardContent — per-slice breakdown gating", () => {
  it("suppresses the breakdown for the booking-calendar shape (no slices)", () => {
    render(<EventCardContent booking={makeBooking()} />);

    // The booking calendar never sets `slices` → no breakdown must render.
    expect(screen.queryByText("Reserved on this booking:")).toBeNull();
  });

  it("suppresses the breakdown for a single standalone slice", () => {
    render(
      <EventCardContent
        booking={makeBooking({
          slices: [{ assetKitId: null, kitName: null, quantity: 1 }],
          sliceCount: 1,
          bookedTotal: 1,
        })}
      />
    );

    expect(screen.queryByText("Reserved on this booking:")).toBeNull();
  });

  it("renders an ordered, pluralized breakdown for standalone + kit slices", () => {
    // Pass kit-first to prove the component sorts standalone before kit.
    const { container } = render(
      <EventCardContent
        booking={makeBooking({
          slices: [KIT_SLICE, STANDALONE],
          sliceCount: 2,
          bookedTotal: 5,
          quantityTracked: true,
        })}
      />
    );

    expect(screen.getByText("Reserved on this booking:")).toBeInTheDocument();
    expect(screen.getByText("Standalone")).toBeInTheDocument();
    expect(screen.getByText('via "Camera Kit"')).toBeInTheDocument();
    expect(screen.getByText("Qty 2")).toBeInTheDocument();
    expect(screen.getByText("Qty 3")).toBeInTheDocument();
    // Plural "units" for a total > 1.
    expect(screen.getByText("Total reserved 5 units")).toBeInTheDocument();

    // Standalone row sorts first even though it was supplied last.
    const rows = container.querySelectorAll("li");
    expect(rows[0]).toHaveTextContent("Standalone");
    expect(rows[1]).toHaveTextContent('via "Camera Kit"');
  });

  it("uses the singular unit label for a single-unit kit-only slice", () => {
    render(
      <EventCardContent
        booking={makeBooking({
          slices: [{ assetKitId: "ak1", kitName: "Kit X", quantity: 1 }],
          sliceCount: 1,
          bookedTotal: 1,
          quantityTracked: true,
        })}
      />
    );

    // A kit-only slice still shows the breakdown; total must read "1 unit".
    expect(screen.getByText("Total reserved 1 unit")).toBeInTheDocument();
  });

  it("hides Qty and the total for INDIVIDUAL assets (qty is redundant)", () => {
    render(
      <EventCardContent
        booking={makeBooking({
          // INDIVIDUAL asset added to a booking via a kit: it is a single
          // physical unit, so `quantityTracked` is false and "Qty 1" would be
          // noise. Attribution ("via Kit") must still render.
          slices: [{ assetKitId: "ak1", kitName: "Camera Kit", quantity: 1 }],
          sliceCount: 1,
          bookedTotal: 1,
          quantityTracked: false,
        })}
      />
    );

    // Kit attribution still shows...
    expect(screen.getByText('via "Camera Kit"')).toBeInTheDocument();
    // ...but the redundant per-slice Qty and the total are suppressed.
    expect(screen.queryByText(/^Qty /)).toBeNull();
    expect(screen.queryByText(/Total reserved/)).toBeNull();
  });
});

// Capitalized alias so the shared renderer is instantiated as a JSX element
// rather than called as a function — the direct-call form trips react-doctor's
// no-render-in-render rule (which ignores eslint-disable comments; only a
// refactor silences it). `makeEventArg` returns the `{ event }` props shape.
const RenderedEventCard = renderEventCard;

describe("renderEventCard — kit glyph gating", () => {
  it("hides the glyph for the booking-calendar shape (no slices)", () => {
    render(<RenderedEventCard {...makeEventArg(makeBooking())} />);

    expect(screen.queryByTitle(/Reserved .* times on this booking/)).toBeNull();
    expect(screen.queryByTitle("Booked via a kit")).toBeNull();
  });

  it("hides the glyph for a single standalone slice", () => {
    render(
      <RenderedEventCard
        {...makeEventArg(
          makeBooking({
            slices: [{ assetKitId: null, kitName: null, quantity: 1 }],
            sliceCount: 1,
            bookedTotal: 1,
          })
        )}
      />
    );

    expect(screen.queryByTitle("Booked via a kit")).toBeNull();
    expect(screen.queryByTitle(/Reserved .* times on this booking/)).toBeNull();
  });

  it("renders the glyph with a slice count for standalone + kit slices", () => {
    render(
      <RenderedEventCard
        {...makeEventArg(
          makeBooking({
            slices: [STANDALONE, KIT_SLICE],
            sliceCount: 2,
            bookedTotal: 5,
          })
        )}
      />
    );

    const glyph = screen.getByTitle("Reserved 2 times on this booking");
    expect(glyph).toHaveTextContent("2");
  });
});
