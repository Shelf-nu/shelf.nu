import { BookingStatus } from "@prisma/client";
import { bookingStatusColorMap } from "~/utils/bookings";
import { getStatusClasses, statusClassesOnHover } from "~/utils/calendar";

// @vitest-environment node

/**
 * The calendar must colour a booking the same way the rest of the product does.
 *
 * `bookingStatusColorMap` is the canonical answer — the badge on the bookings
 * index, the booking detail, the asset page and the companion app all resolve
 * through it. The calendar cannot share it directly, because FullCalendar wants
 * Tailwind class names and the badge wants hex, so the two are kept in step by
 * hand. That is exactly the kind of pairing that drifts silently: OVERDUE was
 * amber here and red everywhere else, and nothing failed.
 */

/** Canonical colour family per status, named as the badge map assigns it. */
const EXPECTED_FAMILY: Record<BookingStatus, string> = {
  DRAFT: "gray",
  ARCHIVED: "gray",
  CANCELLED: "gray",
  RESERVED: "blue",
  ONGOING: "purple",
  OVERDUE: "error",
  COMPLETE: "success",
};

describe("calendar event colours match the rest of the product", () => {
  it.each(Object.values(BookingStatus))(
    "colours %s from a single family",
    (status) => {
      const classes = getStatusClasses(status, false, "dayGridMonth").join(" ");
      const family = EXPECTED_FAMILY[status];

      expect(classes).toContain(`text-${family}-700`);
      expect(classes).toContain(`bg-${family}-50`);
      expect(classes).toContain(`border-${family}-200`);
    }
  );

  it("uses the same family on hover", () => {
    for (const status of Object.values(BookingStatus)) {
      expect(statusClassesOnHover[status]).toContain(
        `bg-${EXPECTED_FAMILY[status]}-100`
      );
    }
  });

  it("shows an overdue booking as an error, not a warning", () => {
    // The regression this exists for. Amber reads as "heads up"; every other
    // surface in the product calls an overdue booking red, and a calendar is
    // where someone scans for exactly that.
    const classes = getStatusClasses(
      BookingStatus.OVERDUE,
      false,
      "dayGridMonth"
    ).join(" ");

    expect(classes).not.toContain("warning");
    expect(statusClassesOnHover.OVERDUE).not.toContain("warning");
  });

  it("keeps every status the badge map knows about", () => {
    // A new BookingStatus must get a deliberate colour here, not fall through
    // the switch's default and render unstyled.
    for (const status of Object.keys(
      bookingStatusColorMap
    ) as BookingStatus[]) {
      expect(EXPECTED_FAMILY[status]).toBeDefined();
    }
  });
});
