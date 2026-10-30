/**
 * Server-side top-booking redaction.
 *
 * The advanced asset query names the biggest upcoming booking on every row.
 * These tests pin that a viewer limited to their own bookings receives the
 * units of that booking but never its id or name, and that a viewer who may
 * see every booking receives the rows as they came.
 *
 * @see {@link file://./booking-visibility.server.ts}
 */
import { describe, expect, it } from "vitest";

import {
  redactTopBookingForViewer,
  type RowWithTopBooking,
} from "./booking-visibility.server";

/** A row shaped like the advanced asset query produces. */
function shortRow() {
  return {
    id: "asset-1",
    title: "Tripod",
    topBookingId: "booking-1",
    topBookingName: "Colleague's shoot",
    topBookingUnits: 7,
  };
}

describe("redactTopBookingForViewer", () => {
  it("returns the rows untouched when the viewer may see every booking", () => {
    const rows = [shortRow()];

    const out = redactTopBookingForViewer(rows, { canSeeAllBookings: true });

    expect(out).toBe(rows);
    expect(out[0].topBookingName).toBe("Colleague's shoot");
    expect(out[0].topBookingId).toBe("booking-1");
  });

  it("nulls the booking's id and name when the viewer may not see every booking", () => {
    const out = redactTopBookingForViewer([shortRow()], {
      canSeeAllBookings: false,
    });

    expect(out[0].topBookingId).toBeNull();
    expect(out[0].topBookingName).toBeNull();
    expect(JSON.stringify(out)).not.toContain("Colleague's shoot");
    expect(JSON.stringify(out)).not.toContain("booking-1");
  });

  it("keeps the units, which the Short figure is computed from", () => {
    const out = redactTopBookingForViewer([shortRow()], {
      canSeeAllBookings: false,
    });

    expect(out[0].topBookingUnits).toBe(7);
    expect(out[0].title).toBe("Tripod");
  });

  it("leaves the input rows untouched, because callers reuse them", () => {
    const rows = [shortRow()];

    redactTopBookingForViewer(rows, { canSeeAllBookings: false });

    expect(rows[0].topBookingId).toBe("booking-1");
    expect(rows[0].topBookingName).toBe("Colleague's shoot");
  });

  it("does not add the fields to a row that never carried them", () => {
    const rows: Array<{ id: string } & RowWithTopBooking> = [{ id: "kit-1" }];
    const out = redactTopBookingForViewer(rows, { canSeeAllBookings: false });

    expect(out[0]).toEqual({ id: "kit-1" });
  });
});
