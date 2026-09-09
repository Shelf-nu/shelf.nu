/**
 * The per-slice reconciliation the check-in receipt prints.
 *
 * These tests are about what ends up ON PAPER for each booked slice: whether it
 * went out, whether it came back, how many units are unaccounted for, and the
 * one line in the header that states completeness. The reference is the
 * completion gate in `checkinBooking` — the receipt is the paper form of what
 * that gate judged — so the cases below are the shapes the gate distinguishes:
 * button check-out (no counter, a stamped marker), progressive check-out (a
 * counter), a re-dispatched slice, and a slice that never left.
 *
 * @see {@link file://./checkin-receipt.ts}
 * @see {@link file://./checkin-receipt.server.ts}
 */
import { AssetType } from "@prisma/client";
import { describe, expect, it } from "vitest";

import type {
  BuildCheckinReceiptArgs,
  CheckinReceiptDispositionBreakdown,
  CheckinReceiptSlice,
} from "./checkin-receipt";
import {
  buildCheckinReceipt,
  formatLatenessNote,
  resolveSentUnits,
} from "./checkin-receipt";

const CHECKED_OUT_AT = new Date("2026-09-01T09:00:00.000Z");
const CHECKED_IN_AT = new Date("2026-09-03T17:30:00.000Z");

/** A slice with the markers of an asset that never left the shelf. */
function slice(
  overrides: Partial<CheckinReceiptSlice> = {}
): CheckinReceiptSlice {
  return {
    bookingAssetId: "ba-1",
    assetId: "asset-1",
    assetType: AssetType.INDIVIDUAL,
    quantity: 1,
    checkedOutAt: null,
    checkedOutQuantity: null,
    checkedInAt: null,
    checkedInById: null,
    ...overrides,
  };
}

/** A disposition breakdown with only the named categories filled in. */
function breakdown(
  values: Partial<CheckinReceiptDispositionBreakdown> = {}
): CheckinReceiptDispositionBreakdown {
  return { returned: 0, consumed: 0, lost: 0, damaged: 0, ...values };
}

/**
 * `buildCheckinReceipt` for a finished booking, the ordinary case these tests
 * describe. Pass `isBookingFinished: false` to exercise a live one.
 */
function build(
  args: Omit<BuildCheckinReceiptArgs, "isBookingFinished"> & {
    isBookingFinished?: boolean;
  }
) {
  return buildCheckinReceipt({ isBookingFinished: true, ...args });
}

/** The row the receipt built for `bookingAssetId`. */
function rowFor(
  result: ReturnType<typeof buildCheckinReceipt>,
  bookingAssetId: string
) {
  const found = result.rows.find((r) => r.bookingAssetId === bookingAssetId);
  expect(found).toBeDefined();
  return found!;
}

describe("buildCheckinReceipt — individual slices", () => {
  it("reports both slices returned when the booking was closed with the check-in button", () => {
    // The button stamps every dispatched slice in one `updateMany`, so both
    // markers carry the same moment and the same user.
    const result = build({
      slices: [
        slice({
          bookingAssetId: "ba-1",
          assetId: "asset-1",
          checkedOutAt: CHECKED_OUT_AT,
          checkedInAt: CHECKED_IN_AT,
          checkedInById: "user-1",
        }),
        slice({
          bookingAssetId: "ba-2",
          assetId: "asset-2",
          checkedOutAt: CHECKED_OUT_AT,
          checkedInAt: CHECKED_IN_AT,
          checkedInById: "user-1",
        }),
      ],
      breakdownByBookingAsset: new Map(),
    });

    expect(rowFor(result, "ba-1").state).toBe("RETURNED");
    expect(rowFor(result, "ba-2").state).toBe("RETURNED");
    expect(result.totals.returned).toBe(2);
    expect(result.totals.stillOut).toBe(0);
    expect(result.stamp).toBe("All items returned");
  });

  it("counts the unreturned slice in the stamp while a scan check-in is in progress", () => {
    const result = build({
      slices: [
        slice({
          bookingAssetId: "ba-1",
          checkedOutAt: CHECKED_OUT_AT,
          checkedInAt: CHECKED_IN_AT,
          checkedInById: "user-1",
        }),
        slice({
          bookingAssetId: "ba-2",
          assetId: "asset-2",
          checkedOutAt: CHECKED_OUT_AT,
        }),
      ],
      breakdownByBookingAsset: new Map(),
    });

    expect(rowFor(result, "ba-2").state).toBe("STILL_OUT");
    expect(result.totals.stillOut).toBe(1);
    expect(result.stamp).toBe("Partial return · 1 still out");
  });

  it("reports a slice that never went out as never checked out, neither returned nor still out", () => {
    // Added onto an ONGOING booking, or left behind by a progressive
    // check-out: it has nothing to reconcile, so it must not read as missing.
    const result = build({
      slices: [
        slice({ bookingAssetId: "ba-1" }),
        slice({
          bookingAssetId: "ba-2",
          assetId: "asset-2",
          checkedOutAt: CHECKED_OUT_AT,
          checkedInAt: CHECKED_IN_AT,
          checkedInById: "user-1",
        }),
      ],
      breakdownByBookingAsset: new Map(),
    });

    const never = rowFor(result, "ba-1");
    expect(never.state).toBe("NEVER_CHECKED_OUT");
    expect(never.sent).toBe(0);
    expect(never.returned).toBe(0);
    expect(never.stillOut).toBe(0);
    expect(result.stamp).toBe("All items returned");
  });

  it("reports a slice sent out again after its return as still out", () => {
    // The check-in has to be no older than the departure it answers: a slice
    // that came back and then left again carries both markers, and the
    // refreshed `checkedOutAt` is what says it is out now.
    const result = build({
      slices: [
        slice({
          checkedInAt: new Date("2026-09-02T10:00:00.000Z"),
          checkedInById: "user-1",
          checkedOutAt: new Date("2026-09-04T08:00:00.000Z"),
        }),
      ],
      breakdownByBookingAsset: new Map(),
    });

    const row = rowFor(result, "ba-1");
    expect(row.state).toBe("STILL_OUT");
    expect(row.stillOut).toBe(1);
    // The recorded moment answers the first trip, not the one it is on now.
    // Printing it beside "Still out" would put a contradiction on the sheet.
    expect(row.checkedInAt).toBeNull();
    expect(row.checkedInById).toBeNull();
  });

  it("prints no check-in moment on a row that never went out", () => {
    // A check-in marker beside a NULL departure claims a return for units that
    // never moved. The row states what it is — never checked out — and nothing
    // more.
    const result = build({
      slices: [
        slice({
          checkedOutAt: null,
          checkedInAt: CHECKED_IN_AT,
          checkedInById: "user-1",
        }),
      ],
      breakdownByBookingAsset: new Map(),
    });

    const row = rowFor(result, "ba-1");
    expect(row.state).toBe("NEVER_CHECKED_OUT");
    expect(row.returned).toBe(0);
    expect(row.checkedInAt).toBeNull();
    expect(row.checkedInById).toBeNull();
  });

  it("counts a legacy session as the return when the slice marker is absent", () => {
    // Rows reconciled before the per-slice markers existed are proven returned
    // by a progressive check-in session naming their asset. The completion gate
    // accepts that session, so a booking it closed must not print as still out.
    const result = build({
      slices: [
        slice({
          checkedOutAt: CHECKED_OUT_AT,
          checkedInAt: null,
          checkedInById: null,
          sessionCheckedInAt: CHECKED_IN_AT,
          sessionCheckedInById: "user-9",
        }),
      ],
      breakdownByBookingAsset: new Map(),
    });

    const row = rowFor(result, "ba-1");
    expect(row.state).toBe("RETURNED");
    expect(row.checkedInAt).toEqual(CHECKED_IN_AT);
    expect(row.checkedInById).toBe("user-9");
  });

  it("ignores a legacy session while the booking is still running", () => {
    // Progressive check-out keeps a slice's ORIGINAL departure and only clears
    // the check-in pair, so on a live booking a session answering an earlier
    // trip still sorts after the recorded departure. Trusting it would print an
    // item that is out right now as returned.
    const result = build({
      slices: [
        slice({
          checkedOutAt: CHECKED_OUT_AT,
          checkedInAt: null,
          checkedInById: null,
          sessionCheckedInAt: CHECKED_IN_AT,
          sessionCheckedInById: "user-9",
        }),
      ],
      breakdownByBookingAsset: new Map(),
      isBookingFinished: false,
    });

    const row = rowFor(result, "ba-1");
    expect(row.state).toBe("STILL_OUT");
    expect(row.checkedInAt).toBeNull();
  });

  it("ignores a session older than the departure it would answer", () => {
    // The same test the marker is held to: a session from the first trip must
    // not reconcile the trip the slice is on now.
    const result = build({
      slices: [
        slice({
          checkedOutAt: new Date("2026-09-04T08:00:00.000Z"),
          sessionCheckedInAt: new Date("2026-09-02T10:00:00.000Z"),
          sessionCheckedInById: "user-9",
        }),
      ],
      breakdownByBookingAsset: new Map(),
    });

    expect(rowFor(result, "ba-1").state).toBe("STILL_OUT");
  });

  it("leaves the receiving user empty when the check-in marker carries no user", () => {
    // Backfilled rows carry a `checkedInAt` with no `checkedInById`. The sheet
    // prints a blank rather than the custodian or the printing user.
    const result = build({
      slices: [
        slice({
          checkedOutAt: CHECKED_OUT_AT,
          checkedInAt: CHECKED_IN_AT,
          checkedInById: null,
        }),
      ],
      breakdownByBookingAsset: new Map(),
    });

    const row = rowFor(result, "ba-1");
    expect(row.state).toBe("RETURNED");
    expect(row.checkedInById).toBeNull();
  });
});

describe("buildCheckinReceipt — quantity-tracked slices", () => {
  it("splits a partly damaged return into its categories with nothing left out", () => {
    const result = build({
      slices: [
        slice({
          assetType: AssetType.QUANTITY_TRACKED,
          quantity: 10,
          checkedOutAt: CHECKED_OUT_AT,
          checkedOutQuantity: 10,
          checkedInAt: CHECKED_IN_AT,
          checkedInById: "user-1",
        }),
      ],
      breakdownByBookingAsset: new Map([
        ["ba-1", breakdown({ returned: 9, damaged: 1 })],
      ]),
    });

    const row = rowFor(result, "ba-1");
    expect(row.sent).toBe(10);
    expect(row.returned).toBe(9);
    expect(row.damaged).toBe(1);
    expect(row.stillOut).toBe(0);
    expect(row.state).toBe("RETURNED");
    expect(result.totals.returned).toBe(9);
    expect(result.totals.damaged).toBe(1);
  });

  it("treats a fully consumed one-way slice as reconciled", () => {
    // A one-way consumable is never returned; the units are accounted for by
    // the CONSUME disposition instead.
    const result = build({
      slices: [
        slice({
          assetType: AssetType.QUANTITY_TRACKED,
          quantity: 4,
          checkedOutAt: CHECKED_OUT_AT,
          checkedOutQuantity: 4,
        }),
      ],
      breakdownByBookingAsset: new Map([["ba-1", breakdown({ consumed: 4 })]]),
    });

    const row = rowFor(result, "ba-1");
    expect(row.consumed).toBe(4);
    expect(row.stillOut).toBe(0);
    expect(row.state).toBe("RETURNED");
    expect(result.totals.consumed).toBe(4);
  });

  it("falls back to the booked quantity when a stamped slice carries a zero counter", () => {
    // The counter was backfilled for rows stamped before it existed, so a
    // stamped marker beside a zero counter means the whole slice went out.
    const result = build({
      slices: [
        slice({
          assetType: AssetType.QUANTITY_TRACKED,
          quantity: 7,
          checkedOutAt: CHECKED_OUT_AT,
          checkedOutQuantity: 0,
        }),
      ],
      breakdownByBookingAsset: new Map(),
    });

    expect(rowFor(result, "ba-1").sent).toBe(7);
  });

  it("keeps each slice's numbers separate when one asset is booked standalone and inside a kit", () => {
    const result = build({
      slices: [
        slice({
          bookingAssetId: "ba-standalone",
          assetType: AssetType.QUANTITY_TRACKED,
          quantity: 5,
          checkedOutAt: CHECKED_OUT_AT,
          checkedOutQuantity: 5,
        }),
        slice({
          bookingAssetId: "ba-kit",
          assetType: AssetType.QUANTITY_TRACKED,
          quantity: 3,
          checkedOutAt: CHECKED_OUT_AT,
          checkedOutQuantity: 3,
        }),
      ],
      breakdownByBookingAsset: new Map([
        ["ba-standalone", breakdown({ returned: 5 })],
        ["ba-kit", breakdown({ returned: 2, lost: 1 })],
      ]),
    });

    expect(rowFor(result, "ba-standalone").returned).toBe(5);
    expect(rowFor(result, "ba-kit").returned).toBe(2);
    expect(rowFor(result, "ba-kit").lost).toBe(1);
    expect(result.totals.unitsSentOut).toBe(8);
    expect(result.totals.returned).toBe(7);
    expect(result.totals.lost).toBe(1);
    expect(result.totals.stillOut).toBe(0);
  });

  it("never settles a quantity slice from a session, which cannot express units", () => {
    // A session names an asset, not a number of units, so it cannot say how
    // much of a quantity slice came back. Its attributed units answer that.
    const result = build({
      slices: [
        slice({
          assetType: AssetType.QUANTITY_TRACKED,
          quantity: 6,
          checkedOutAt: CHECKED_OUT_AT,
          checkedOutQuantity: 6,
          sessionCheckedInAt: CHECKED_IN_AT,
          sessionCheckedInById: "user-9",
        }),
      ],
      breakdownByBookingAsset: new Map([["ba-1", breakdown({ returned: 2 })]]),
    });

    const row = rowFor(result, "ba-1");
    expect(row.state).toBe("STILL_OUT");
    expect(row.stillOut).toBe(4);
    expect(row.checkedInAt).toBeNull();
  });

  it("reports every sent unit as still out when the slice has no attributed dispositions", () => {
    const result = build({
      slices: [
        slice({
          assetType: AssetType.QUANTITY_TRACKED,
          quantity: 6,
          checkedOutAt: CHECKED_OUT_AT,
          checkedOutQuantity: 6,
        }),
      ],
      breakdownByBookingAsset: new Map(),
    });

    const row = rowFor(result, "ba-1");
    expect(row.returned).toBe(0);
    expect(row.stillOut).toBe(6);
    expect(row.state).toBe("STILL_OUT");
  });

  it("drops a quantity slice's check-in moment once it is dispatched again", () => {
    // `checkedInAt` means fully reconciled, so a marker older than the current
    // departure describes a trip that has already been settled.
    const result = build({
      slices: [
        slice({
          assetType: AssetType.QUANTITY_TRACKED,
          quantity: 4,
          checkedInAt: new Date("2026-09-02T10:00:00.000Z"),
          checkedInById: "user-1",
          checkedOutAt: new Date("2026-09-04T08:00:00.000Z"),
          checkedOutQuantity: 8,
        }),
      ],
      breakdownByBookingAsset: new Map([["ba-1", breakdown({ returned: 4 })]]),
    });

    const row = rowFor(result, "ba-1");
    expect(row.stillOut).toBe(4);
    expect(row.checkedInAt).toBeNull();
    expect(row.checkedInById).toBeNull();
  });

  it("prints no check-in moment while a stamped slice still owes units", () => {
    // A quantity slice can carry a settled marker and still owe units: untagged
    // logs cap at the booked quantity, so a re-dispatched slice reconciles its
    // marker while part of the second trip is unaccounted for. A row stating
    // both a return time and an outstanding count says two things at once.
    const result = build({
      slices: [
        slice({
          assetType: AssetType.QUANTITY_TRACKED,
          quantity: 4,
          checkedOutAt: CHECKED_OUT_AT,
          checkedOutQuantity: 8,
          checkedInAt: CHECKED_IN_AT,
          checkedInById: "user-1",
        }),
      ],
      breakdownByBookingAsset: new Map([["ba-1", breakdown({ returned: 4 })]]),
    });

    const row = rowFor(result, "ba-1");
    expect(row.state).toBe("STILL_OUT");
    expect(row.stillOut).toBe(4);
    expect(row.checkedInAt).toBeNull();
    expect(row.checkedInById).toBeNull();
  });

  it("measures a re-dispatched slice against the cumulative counter, not the booked quantity", () => {
    // `checkedOutQuantity` is never decremented, so a slice that went out,
    // came back and went out again has sent more units than it booked.
    const args = {
      slices: [
        slice({
          assetType: AssetType.QUANTITY_TRACKED,
          quantity: 3,
          checkedOutAt: CHECKED_OUT_AT,
          checkedOutQuantity: 6,
        }),
      ],
    };

    const settled = build({
      ...args,
      breakdownByBookingAsset: new Map([["ba-1", breakdown({ returned: 6 })]]),
    });
    expect(rowFor(settled, "ba-1").stillOut).toBe(0);

    const halfway = build({
      ...args,
      breakdownByBookingAsset: new Map([["ba-1", breakdown({ returned: 3 })]]),
    });
    expect(rowFor(halfway, "ba-1").stillOut).toBe(3);
  });
});

describe("buildCheckinReceipt — status stamp", () => {
  it("refuses to state a return on a booking nothing ever left on", () => {
    // Archiving a reserved booking reaches this sheet with every row never
    // dispatched. "All items returned" would put a return on paper that never
    // happened.
    const result = build({
      slices: [
        slice({ bookingAssetId: "ba-1" }),
        slice({ bookingAssetId: "ba-2" }),
      ],
      breakdownByBookingAsset: new Map(),
    });

    expect(result.totals.unitsSentOut).toBe(0);
    expect(result.stamp).toBe("Nothing was checked out");
  });

  it("refuses to call a write-off a return", () => {
    // Every unit is accounted for and nothing is outstanding, but none came
    // back. "All items returned" printed over a ledger reading "Lost 6" is a
    // false claim on a document that gets signed.
    const result = build({
      slices: [
        slice({
          assetType: AssetType.QUANTITY_TRACKED,
          quantity: 6,
          checkedOutAt: CHECKED_OUT_AT,
          checkedOutQuantity: 6,
        }),
      ],
      breakdownByBookingAsset: new Map([["ba-1", breakdown({ lost: 6 })]]),
    });

    expect(result.totals.returned).toBe(0);
    expect(result.totals.stillOut).toBe(0);
    expect(result.stamp).toBe("All items accounted for");
  });

  it("says items returned only when every dispatched unit came back", () => {
    const result = build({
      slices: [
        slice({
          assetType: AssetType.QUANTITY_TRACKED,
          quantity: 4,
          checkedOutAt: CHECKED_OUT_AT,
          checkedOutQuantity: 4,
        }),
      ],
      breakdownByBookingAsset: new Map([["ba-1", breakdown({ returned: 4 })]]),
    });

    expect(result.stamp).toBe("All items returned");
  });

  it("still leads with the outstanding count when units are written off and some are out", () => {
    const result = build({
      slices: [
        slice({
          assetType: AssetType.QUANTITY_TRACKED,
          quantity: 6,
          checkedOutAt: CHECKED_OUT_AT,
          checkedOutQuantity: 6,
        }),
      ],
      breakdownByBookingAsset: new Map([["ba-1", breakdown({ damaged: 2 })]]),
    });

    expect(result.stamp).toBe("Partial return · 4 still out");
  });

  it("states the outstanding total in units, not in rows", () => {
    const result = build({
      slices: [
        slice({
          bookingAssetId: "ba-qty",
          assetType: AssetType.QUANTITY_TRACKED,
          quantity: 3,
          checkedOutAt: CHECKED_OUT_AT,
          checkedOutQuantity: 3,
        }),
        slice({
          bookingAssetId: "ba-individual",
          assetId: "asset-2",
          checkedOutAt: CHECKED_OUT_AT,
        }),
      ],
      breakdownByBookingAsset: new Map(),
    });

    expect(result.totals.stillOut).toBe(4);
    expect(result.stamp).toBe("Partial return · 4 still out");
  });
});

const ONE_MINUTE_MS = 60 * 1000;
const ONE_HOUR_MS = 60 * ONE_MINUTE_MS;
const ONE_DAY_MS = 24 * ONE_HOUR_MS;

describe("formatLatenessNote", () => {
  it("says nothing when the booking has not finished or recorded a return", () => {
    expect(formatLatenessNote(null)).toBeNull();
  });

  it("counts a return inside the compliance grace period as on time", () => {
    // The same 15 minutes the Booking Compliance report allows, so the sheet
    // and the report never disagree.
    expect(formatLatenessNote(10 * ONE_MINUTE_MS)).toEqual({
      text: "on time",
      isLate: false,
    });
    expect(formatLatenessNote(-10 * ONE_MINUTE_MS)).toEqual({
      text: "on time",
      isLate: false,
    });
  });

  it("states an early return as early rather than as a negative lateness", () => {
    expect(formatLatenessNote(-3 * ONE_HOUR_MS)).toEqual({
      text: "early",
      isLate: false,
    });
  });

  it("measures a late return against the planned end", () => {
    expect(formatLatenessNote(16 * ONE_HOUR_MS)).toEqual({
      text: "16 hours after the planned end",
      isLate: true,
    });
    expect(formatLatenessNote(ONE_HOUR_MS + 30 * ONE_MINUTE_MS)).toEqual({
      text: "1 hour 30 minutes after the planned end",
      isLate: true,
    });
  });

  it("prints the two most significant units of a long overrun", () => {
    // A receipt states how late a return was; the remaining minutes are noise
    // beside twelve days.
    expect(
      formatLatenessNote(
        12 * ONE_DAY_MS + 20 * ONE_HOUR_MS + 42 * ONE_MINUTE_MS
      )
    ).toEqual({
      text: "12 days 20 hours after the planned end",
      isLate: true,
    });
  });
});

describe("resolveSentUnits", () => {
  // The receipt measures a row against this, and the disposition attributor
  // sizes the row's capacity from it, so a slice can never be credited with
  // more than it sent.
  it("counts nothing for a slice that never went out", () => {
    expect(
      resolveSentUnits({
        quantity: 5,
        checkedOutAt: null,
        checkedOutQuantity: 0,
      })
    ).toBe(0);
  });

  it("counts the cumulative counter once units have been dispatched", () => {
    expect(
      resolveSentUnits({
        quantity: 3,
        checkedOutAt: CHECKED_OUT_AT,
        checkedOutQuantity: 6,
      })
    ).toBe(6);
  });

  it("falls back to the booked quantity for a stamped slice with a zero counter", () => {
    expect(
      resolveSentUnits({
        quantity: 4,
        checkedOutAt: CHECKED_OUT_AT,
        checkedOutQuantity: 0,
      })
    ).toBe(4);
  });

  it("trusts a positive counter even without a departure marker", () => {
    // The counter is only ever incremented on dispatch, so a positive value is
    // itself proof that units left. The two are written together, so this pairs
    // only on inconsistent data — and there the counter is the record that says
    // something actually moved.
    expect(
      resolveSentUnits({
        quantity: 4,
        checkedOutAt: null,
        checkedOutQuantity: 6,
      })
    ).toBe(6);
  });
});
