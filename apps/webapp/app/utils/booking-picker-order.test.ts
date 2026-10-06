import { describe, expect, it } from "vitest";

import { sortPickerBookings } from "./booking-picker-order";

/** 2026-06-15T12:00:00.000Z, the moment every case below is judged against. */
const NOW = new Date("2026-06-15T12:00:00.000Z").getTime();

describe("sortPickerBookings", () => {
  it("puts the most recently finished booking first when everything has ended", () => {
    const sorted = sortPickerBookings(
      [
        {
          id: "january",
          from: "2026-01-05T09:00:00.000Z",
          to: "2026-01-06T17:00:00.000Z",
        },
        {
          id: "may",
          from: "2026-05-01T09:00:00.000Z",
          to: "2026-05-02T17:00:00.000Z",
        },
        {
          id: "march",
          from: "2026-03-10T09:00:00.000Z",
          to: "2026-03-11T17:00:00.000Z",
        },
      ],
      NOW
    );

    expect(sorted.map((booking) => booking.id)).toEqual([
      "may",
      "march",
      "january",
    ]);
  });

  it("puts the soonest booking first when nothing has ended", () => {
    const sorted = sortPickerBookings(
      [
        {
          id: "august",
          from: "2026-08-01T09:00:00.000Z",
          to: "2026-08-02T17:00:00.000Z",
        },
        {
          id: "tomorrow",
          from: "2026-06-16T09:00:00.000Z",
          to: "2026-06-17T17:00:00.000Z",
        },
        {
          id: "july",
          from: "2026-07-01T09:00:00.000Z",
          to: "2026-07-02T17:00:00.000Z",
        },
      ],
      NOW
    );

    expect(sorted.map((booking) => booking.id)).toEqual([
      "tomorrow",
      "july",
      "august",
    ]);
  });

  it("keeps every not-ended booking above every ended one, each group in its own order", () => {
    const sorted = sortPickerBookings(
      [
        {
          id: "ended-january",
          from: "2026-01-05T09:00:00.000Z",
          to: "2026-01-06T17:00:00.000Z",
        },
        {
          id: "upcoming-august",
          from: "2026-08-01T09:00:00.000Z",
          to: "2026-08-02T17:00:00.000Z",
        },
        {
          id: "ended-may",
          from: "2026-05-01T09:00:00.000Z",
          to: "2026-05-02T17:00:00.000Z",
        },
        // Started before `now` and ends after it, so it is ongoing rather than
        // ended and belongs in the first group.
        {
          id: "ongoing",
          from: "2026-06-14T09:00:00.000Z",
          to: "2026-06-16T17:00:00.000Z",
        },
        {
          id: "upcoming-july",
          from: "2026-07-01T09:00:00.000Z",
          to: "2026-07-02T17:00:00.000Z",
        },
      ],
      NOW
    );

    expect(sorted.map((booking) => booking.id)).toEqual([
      "ongoing",
      "upcoming-july",
      "upcoming-august",
      "ended-may",
      "ended-january",
    ]);
  });

  it("does not mutate the array it is given", () => {
    const bookings = [
      {
        id: "january",
        from: "2026-01-05T09:00:00.000Z",
        to: "2026-01-06T17:00:00.000Z",
      },
      {
        id: "may",
        from: "2026-05-01T09:00:00.000Z",
        to: "2026-05-02T17:00:00.000Z",
      },
    ];

    const sorted = sortPickerBookings(bookings, NOW);

    expect(bookings.map((booking) => booking.id)).toEqual(["january", "may"]);
    expect(sorted).not.toBe(bookings);
  });

  it("treats a booking ending exactly at `now` as not ended", () => {
    // The boundary is strict: only a `to` in the past counts as ended, so a
    // booking finishing on this very millisecond sorts with the live ones.
    const sorted = sortPickerBookings(
      [
        {
          id: "ended-yesterday",
          from: "2026-06-13T09:00:00.000Z",
          to: "2026-06-14T17:00:00.000Z",
        },
        {
          id: "ends-now",
          from: "2026-06-15T09:00:00.000Z",
          to: "2026-06-15T12:00:00.000Z",
        },
      ],
      NOW
    );

    expect(sorted.map((booking) => booking.id)).toEqual([
      "ends-now",
      "ended-yesterday",
    ]);
  });

  it("orders rows whose dates arrive as Date objects", () => {
    // The pickers are typed from Prisma's `Booking`, so `from`/`to` are `Date`
    // at the type level even though JSON delivers them as strings.
    const sorted = sortPickerBookings(
      [
        {
          id: "ended-january",
          from: new Date("2026-01-05T09:00:00.000Z"),
          to: new Date("2026-01-06T17:00:00.000Z"),
        },
        {
          id: "upcoming-july",
          from: new Date("2026-07-01T09:00:00.000Z"),
          to: new Date("2026-07-02T17:00:00.000Z"),
        },
        {
          id: "ended-may",
          from: new Date("2026-05-01T09:00:00.000Z"),
          to: new Date("2026-05-02T17:00:00.000Z"),
        },
      ],
      NOW
    );

    expect(sorted.map((booking) => booking.id)).toEqual([
      "upcoming-july",
      "ended-may",
      "ended-january",
    ]);
  });

  it("orders a list mixing string and Date dates", () => {
    const sorted = sortPickerBookings(
      [
        {
          id: "ended-string",
          from: "2026-02-01T09:00:00.000Z",
          to: "2026-02-02T17:00:00.000Z",
        },
        {
          id: "ended-date",
          from: new Date("2026-05-01T09:00:00.000Z"),
          to: new Date("2026-05-02T17:00:00.000Z"),
        },
        {
          id: "upcoming-string",
          from: "2026-07-01T09:00:00.000Z",
          to: "2026-07-02T17:00:00.000Z",
        },
        {
          id: "upcoming-date",
          from: new Date("2026-06-20T09:00:00.000Z"),
          to: new Date("2026-06-21T17:00:00.000Z"),
        },
      ],
      NOW
    );

    expect(sorted.map((booking) => booking.id)).toEqual([
      "upcoming-date",
      "upcoming-string",
      "ended-date",
      "ended-string",
    ]);
  });

  it("returns an empty array unchanged in content", () => {
    expect(sortPickerBookings([], NOW)).toEqual([]);
  });
});
