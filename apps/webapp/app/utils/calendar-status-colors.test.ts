import { BookingStatus } from "@prisma/client";
import { BADGE_COLORS } from "~/utils/badge-colors";
import { bookingStatusColorMap } from "~/utils/bookings";
import { getStatusClasses } from "~/utils/calendar";

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
 *
 * So the expectations are DERIVED from the canonical map rather than restated.
 * A hardcoded second list would pass happily while the two sources diverged,
 * which is the failure this suite exists to prevent.
 */

/**
 * The one translation this file is allowed to hardcode: a badge colour to the
 * Tailwind family that renders it. Everything else is looked up.
 *
 * Keyed by the shared `BADGE_COLORS` objects themselves, so a status pointed at
 * a colour with no calendar equivalent resolves to undefined and fails loudly
 * rather than silently skipping.
 */
const FAMILY_BY_BADGE_COLOR = new Map<unknown, string>([
  [BADGE_COLORS.gray, "gray"],
  [BADGE_COLORS.blue, "blue"],
  [BADGE_COLORS.violet, "purple"],
  [BADGE_COLORS.red, "error"],
  [BADGE_COLORS.green, "success"],
]);

/** The Tailwind family the canonical map says this status should wear. */
function expectedFamily(status: BookingStatus): string {
  const family = FAMILY_BY_BADGE_COLOR.get(bookingStatusColorMap[status]);
  if (!family) {
    throw new Error(
      `bookingStatusColorMap.${status} uses a badge colour with no calendar ` +
        `equivalent. Add the family to FAMILY_BY_BADGE_COLOR and give the ` +
        `calendar a matching case, or the two surfaces will disagree.`
    );
  }
  return family;
}

describe("calendar event colours match the rest of the product", () => {
  it.each(Object.values(BookingStatus))(
    "colours %s from the family the badge map assigns",
    (status) => {
      const classes = getStatusClasses(status, false, "dayGridMonth").join(" ");
      const family = expectedFamily(status);

      expect(classes).toContain(`text-${family}-700`);
      expect(classes).toContain(`bg-${family}-50`);
      expect(classes).toContain(`border-${family}-200`);
    }
  );

  it.each(Object.values(BookingStatus))(
    "uses the same family for %s on the hover-capable views",
    (status) => {
      // Through getStatusClasses, not the lookup table it reads, so a
      // regression where the hover class stops being appended is caught.
      //
      // Compared as a whole class token rather than a substring: the base set
      // already carries `md:focus:!bg-<family>-100`, so `toContain` matched it
      // and passed even with the hover class gone.
      const classes = getStatusClasses(status, false, "timeGridWeek");

      expect(classes).toContain(`md:!bg-${expectedFamily(status)}-100`);
    }
  );

  it("shows an overdue booking as an error, not a warning", () => {
    // The regression this exists for. Amber reads as "heads up"; every other
    // surface in the product calls an overdue booking red, and a calendar is
    // where someone scans for exactly that.
    expect(expectedFamily(BookingStatus.OVERDUE)).toBe("error");

    for (const view of ["dayGridMonth", "timeGridWeek"] as const) {
      const classes = getStatusClasses(BookingStatus.OVERDUE, false, view).join(
        " "
      );
      expect(classes).not.toContain("warning");
    }
  });

  it("gives every booking status a calendar colour", () => {
    // A new BookingStatus must get a deliberate colour, not fall through the
    // switch's default and render unstyled.
    for (const status of Object.values(BookingStatus)) {
      expect(() => expectedFamily(status)).not.toThrow();
      expect(getStatusClasses(status, false, "dayGridMonth").join(" ")).toMatch(
        /text-\w+-700/
      );
    }
  });
});
