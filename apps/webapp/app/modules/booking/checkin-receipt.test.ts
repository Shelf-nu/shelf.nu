/**
 * The per-slice reconciliation the check-in receipt prints.
 *
 * These tests are about what ends up ON PAPER for each booked slice: whether it
 * went out, whether it came back, how many units are unaccounted for, and the
 * one line in the header that states completeness. A finished booking passed a
 * check-in that reconciled everything it sent out, so its status is the record
 * that every dispatched item came back; a live booking is judged by its markers
 * alone. The cases below are the shapes those two readings distinguish: button
 * check-out (no counter, a stamped marker), progressive check-out (a counter),
 * a re-dispatched slice, a slice that never left, and a finished booking whose
 * markers do not date a return after the departure.
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
  resolveReceiptMoments,
  resolveSentUnits,
  summariseCheckinMethods,
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
      isBookingFinished: false,
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

  it("reports a slice sent out again after its return as still out while the booking runs", () => {
    // On a live booking the check-in has to be no older than the departure it
    // answers: a slice that came back and then left again carries both
    // markers, and the refreshed `checkedOutAt` is what says it is out now.
    const result = build({
      slices: [
        slice({
          checkedInAt: new Date("2026-09-02T10:00:00.000Z"),
          checkedInById: "user-1",
          checkedOutAt: new Date("2026-09-04T08:00:00.000Z"),
        }),
      ],
      breakdownByBookingAsset: new Map(),
      isBookingFinished: false,
    });

    const row = rowFor(result, "ba-1");
    expect(row.state).toBe("STILL_OUT");
    expect(row.stillOut).toBe(1);
    // The recorded moment answers the first trip, not the one it is on now.
    // Printing it beside "Still out" would put a contradiction on the sheet.
    expect(row.checkedInAt).toBeNull();
    expect(row.checkedInByIds).toEqual([]);
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
    expect(row.checkedInByIds).toEqual([]);
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
    expect(row.checkedInByIds).toEqual([]);
  });
});

/** A departure stamped from the booking's last update, later than its returns. */
const STAMPED_DEPARTURE = new Date("2025-10-02T14:48:20.311Z");
/** A return marker stamped from a check-in session, earlier than that departure. */
const SESSION_RETURN = new Date("2025-09-26T11:45:52.688Z");

describe("buildCheckinReceipt on a finished booking", () => {
  // A booking reaches COMPLETE only through a check-in that reconciles every
  // dispatched item, and ARCHIVED only from COMPLETE or from a reservation
  // nothing left on. So on a finished booking an INDIVIDUAL slice that went out
  // came back, whatever order its two markers carry.

  it("reports a slice returned when its recorded return predates its recorded departure", () => {
    const result = build({
      slices: [
        slice({
          checkedOutAt: STAMPED_DEPARTURE,
          checkedInAt: SESSION_RETURN,
          checkedInById: "user-1",
        }),
      ],
      breakdownByBookingAsset: new Map(),
    });

    const row = rowFor(result, "ba-1");
    expect(row.state).toBe("RETURNED");
    expect(row.returned).toBe(1);
    expect(row.stillOut).toBe(0);
    // The marker is the record of the return, so it dates the row.
    expect(row.checkedInAt).toEqual(SESSION_RETURN);
    expect(row.checkedInByIds).toEqual(["user-1"]);
  });

  it("reports a dispatched slice returned when nothing dated its return", () => {
    // No return marker: the booking's status is the only record. The row
    // prints a blank date and a blank receiver rather than a guess.
    const result = build({
      slices: [slice({ checkedOutAt: STAMPED_DEPARTURE })],
      breakdownByBookingAsset: new Map(),
    });

    const row = rowFor(result, "ba-1");
    expect(row.state).toBe("RETURNED");
    expect(row.returned).toBe(1);
    expect(row.stillOut).toBe(0);
    expect(row.checkedInAt).toBeNull();
    expect(row.checkedInByIds).toEqual([]);
    expect(result.stamp).toBe("All items returned");
  });

  it("states every item returned when a kit member carries no check-in marker", () => {
    // Two loose items came back in a scan session, which dates their markers.
    // The kit member carries no check-in marker at all. All three departures
    // carry the booking's last update, later than the session.
    const returnedInSession = {
      checkedOutAt: STAMPED_DEPARTURE,
      checkedInAt: SESSION_RETURN,
      checkedInById: "user-1",
    };
    const result = build({
      slices: [
        slice({
          bookingAssetId: "ba-1",
          assetId: "asset-1",
          ...returnedInSession,
        }),
        slice({
          bookingAssetId: "ba-2",
          assetId: "asset-2",
          ...returnedInSession,
        }),
        slice({
          bookingAssetId: "ba-kit-member",
          assetId: "asset-3",
          checkedOutAt: STAMPED_DEPARTURE,
        }),
      ],
      breakdownByBookingAsset: new Map(),
    });

    expect(result.rows.map((row) => row.state)).toEqual([
      "RETURNED",
      "RETURNED",
      "RETURNED",
    ]);
    expect(result.rows.map((row) => row.checkedInAt)).toEqual([
      SESSION_RETURN,
      SESSION_RETURN,
      null,
    ]);
    expect(result.totals.returned).toBe(3);
    expect(result.totals.stillOut).toBe(0);
    expect(result.stamp).toBe("All items returned");
  });

  it("keeps a quantity slice's unaccounted units outstanding", () => {
    // Units are counted from the logs that accounted for them, the way the
    // completion gate counts them. A booking can close with units left
    // pending, and its status does not say how many, so a unit no log accounts
    // for stays out rather than being printed as returned.
    const result = build({
      slices: [
        slice({
          assetType: AssetType.QUANTITY_TRACKED,
          quantity: 5,
          checkedOutAt: STAMPED_DEPARTURE,
          checkedOutQuantity: 5,
          checkedInAt: SESSION_RETURN,
          checkedInById: "user-1",
        }),
      ],
      breakdownByBookingAsset: new Map([["ba-1", breakdown({ returned: 3 })]]),
    });

    const row = rowFor(result, "ba-1");
    expect(row.state).toBe("STILL_OUT");
    expect(row.returned).toBe(3);
    expect(row.stillOut).toBe(2);
    // The marker dates the whole slice, and the slice still owes units.
    expect(row.checkedInAt).toBeNull();
    expect(result.stamp).toBe("Partial return · 2 still out");
  });

  it("dates a quantity row from its return logs, not from a marker older than its departure", () => {
    // The status settles INDIVIDUAL items only, so a quantity marker is held
    // to its departure here as on a live booking, and the logs that recorded
    // the units date the row and name who took them.
    const result = build({
      slices: [
        slice({
          assetType: AssetType.QUANTITY_TRACKED,
          quantity: 4,
          checkedOutAt: STAMPED_DEPARTURE,
          checkedOutQuantity: 4,
          checkedInAt: SESSION_RETURN,
          checkedInById: "user-1",
          returnRecords: [{ at: CHECKED_IN_AT, byId: "user-7" }],
        }),
      ],
      breakdownByBookingAsset: new Map([["ba-1", breakdown({ returned: 4 })]]),
    });

    const row = rowFor(result, "ba-1");
    expect(row.state).toBe("RETURNED");
    expect(row.checkedInAt).toEqual(CHECKED_IN_AT);
    expect(row.checkedInByIds).toEqual(["user-7"]);
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
    // `checkedInAt` means fully reconciled, so on a live booking a marker older
    // than the current departure describes a trip that has already been
    // settled.
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
      isBookingFinished: false,
    });

    const row = rowFor(result, "ba-1");
    expect(row.stillOut).toBe(4);
    expect(row.checkedInAt).toBeNull();
    expect(row.checkedInByIds).toEqual([]);
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
    expect(row.checkedInByIds).toEqual([]);
  });

  it("dates a partly-returned quantity row from the log that recorded the units", () => {
    // A quantity slice returned in part never gets a check-in marker, because
    // that marker means fully reconciled. Without the log the sheet prints
    // "3 returned" with no date and no name against it, which is the weak
    // evidence this document exists to replace.
    const returnedAt = new Date("2026-09-02T11:00:00.000Z");
    const result = build({
      slices: [
        slice({
          assetType: AssetType.QUANTITY_TRACKED,
          quantity: 6,
          checkedOutAt: CHECKED_OUT_AT,
          checkedOutQuantity: 6,
          returnRecords: [{ at: returnedAt, byId: "user-7" }],
        }),
      ],
      breakdownByBookingAsset: new Map([["ba-1", breakdown({ returned: 3 })]]),
      isBookingFinished: false,
    });

    const row = rowFor(result, "ba-1");
    // Still owed units, and the moment prints anyway: a log dates the units it
    // records, where a marker dates the whole slice.
    expect(row.state).toBe("STILL_OUT");
    expect(row.stillOut).toBe(3);
    expect(row.checkedInAt).toEqual(returnedAt);
    expect(row.checkedInByIds).toEqual(["user-7"]);
  });

  it("never names a write-off logger as a receiver", () => {
    // A consumed, lost or damaged unit was written off, not handed over. The
    // server passes returns only, so a slice whose logs are all write-offs has
    // nothing to date it and nobody to name.
    const result = build({
      slices: [
        slice({
          assetType: AssetType.QUANTITY_TRACKED,
          quantity: 6,
          checkedOutAt: CHECKED_OUT_AT,
          checkedOutQuantity: 6,
          returnRecords: [],
        }),
      ],
      breakdownByBookingAsset: new Map([["ba-1", breakdown({ lost: 6 })]]),
    });

    const row = rowFor(result, "ba-1");
    expect(row.lost).toBe(6);
    expect(row.checkedInAt).toBeNull();
    expect(row.checkedInByIds).toEqual([]);
  });

  it("names every person who returned units, in the order they did", () => {
    const first = new Date("2026-09-02T11:00:00.000Z");
    const second = new Date("2026-09-03T09:00:00.000Z");
    const result = build({
      slices: [
        slice({
          assetType: AssetType.QUANTITY_TRACKED,
          quantity: 6,
          checkedOutAt: CHECKED_OUT_AT,
          checkedOutQuantity: 6,
          returnRecords: [
            { at: second, byId: "user-b" },
            { at: first, byId: "user-a" },
          ],
        }),
      ],
      breakdownByBookingAsset: new Map([["ba-1", breakdown({ returned: 6 })]]),
    });

    const row = rowFor(result, "ba-1");
    // The latest moment, and both people in the order they first handled units.
    expect(row.checkedInAt).toEqual(second);
    expect(row.checkedInByIds).toEqual(["user-a", "user-b"]);
  });

  it("dates nothing from untagged legacy logs", () => {
    // Untagged logs are spread across an asset's slices by a greedy pass that
    // carries no times, so the server hands none of them over. A blank is
    // honest; a borrowed moment would be a guess.
    const result = build({
      slices: [
        slice({
          assetType: AssetType.QUANTITY_TRACKED,
          quantity: 6,
          checkedOutAt: CHECKED_OUT_AT,
          checkedOutQuantity: 6,
          returnRecords: [],
        }),
      ],
      breakdownByBookingAsset: new Map([["ba-1", breakdown({ returned: 6 })]]),
    });

    const row = rowFor(result, "ba-1");
    expect(row.state).toBe("RETURNED");
    expect(row.checkedInAt).toBeNull();
    expect(row.checkedInByIds).toEqual([]);
  });

  it("prefers the slice marker over the logs once the slice is settled", () => {
    // The marker means the whole slice is reconciled, which is a stronger
    // statement than any single log, so it answers first.
    const result = build({
      slices: [
        slice({
          assetType: AssetType.QUANTITY_TRACKED,
          quantity: 6,
          checkedOutAt: CHECKED_OUT_AT,
          checkedOutQuantity: 6,
          checkedInAt: CHECKED_IN_AT,
          checkedInById: "user-1",
          returnRecords: [
            { at: new Date("2026-09-02T11:00:00.000Z"), byId: "user-7" },
          ],
        }),
      ],
      breakdownByBookingAsset: new Map([["ba-1", breakdown({ returned: 6 })]]),
    });

    const row = rowFor(result, "ba-1");
    expect(row.checkedInAt).toEqual(CHECKED_IN_AT);
    expect(row.checkedInByIds).toEqual(["user-1"]);
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

  it("does not call an outstanding write-off a partial return", () => {
    // Two units damaged, four unaccounted for, none returned. The outstanding
    // count is the fact worth leading with, but "partial return" in front of it
    // claims something the ledger below contradicts.
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

    expect(result.totals.returned).toBe(0);
    expect(result.stamp).toBe("Nothing returned · 4 still out");
  });

  it("calls it a partial return once some units have come back", () => {
    const result = build({
      slices: [
        slice({
          assetType: AssetType.QUANTITY_TRACKED,
          quantity: 6,
          checkedOutAt: CHECKED_OUT_AT,
          checkedOutQuantity: 6,
        }),
      ],
      breakdownByBookingAsset: new Map([
        ["ba-1", breakdown({ returned: 1, damaged: 1 })],
      ]),
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
      isBookingFinished: false,
    });

    expect(result.totals.stillOut).toBe(4);
    // Two rows, four units. Nothing came back, so the sentence in front of the
    // count says so.
    expect(result.stamp).toBe("Nothing returned · 4 still out");
  });
});

describe("resolveReceiptMoments", () => {
  const EARLIER = new Date("2026-09-02T10:00:00.000Z");

  /** Rows of a finished booking, reconciled by the real rules. */
  function finishedRows(
    slices: CheckinReceiptSlice[],
    breakdowns: Map<string, CheckinReceiptDispositionBreakdown> = new Map()
  ) {
    return build({ slices, breakdownByBookingAsset: breakdowns }).rows;
  }

  it("takes the departure from the earliest slice that names its dispatcher", () => {
    const moments = resolveReceiptMoments({
      rows: [],
      departures: [
        // Earlier, but no user is recorded making it.
        {
          checkedOutAt: new Date("2026-08-30T09:00:00.000Z"),
          checkedOutById: null,
        },
        { checkedOutAt: CHECKED_IN_AT, checkedOutById: "user-2" },
        { checkedOutAt: CHECKED_OUT_AT, checkedOutById: "user-1" },
        { checkedOutAt: null, checkedOutById: null },
      ],
      completedAt: null,
    });

    expect(moments.checkedOutAt).toEqual(CHECKED_OUT_AT);
    expect(moments.checkedOutById).toBe("user-1");
  });

  it("states no departure when no slice names its dispatcher", () => {
    const moments = resolveReceiptMoments({
      rows: [],
      departures: [{ checkedOutAt: CHECKED_OUT_AT, checkedOutById: null }],
      completedAt: null,
    });

    expect(moments.checkedOutAt).toBeNull();
    expect(moments.checkedOutById).toBeNull();
  });

  it("returns the booking at its completion event whatever the rows carry", () => {
    const moments = resolveReceiptMoments({
      rows: finishedRows([slice({ checkedOutAt: CHECKED_OUT_AT })]),
      departures: [],
      completedAt: CHECKED_IN_AT,
    });

    expect(moments.returnedAt).toEqual(CHECKED_IN_AT);
  });

  it("falls back to the latest row moment when every returned row is dated", () => {
    const moments = resolveReceiptMoments({
      rows: finishedRows([
        slice({
          bookingAssetId: "ba-1",
          checkedOutAt: CHECKED_OUT_AT,
          checkedInAt: EARLIER,
          checkedInById: "user-2",
        }),
        slice({
          bookingAssetId: "ba-2",
          assetId: "asset-2",
          checkedOutAt: CHECKED_OUT_AT,
          checkedInAt: CHECKED_IN_AT,
          checkedInById: "user-1",
        }),
      ]),
      departures: [],
      completedAt: null,
    });

    expect(moments.returnedAt).toEqual(CHECKED_IN_AT);
    // In the order they first received something.
    expect(moments.checkedInByIds).toEqual(["user-2", "user-1"]);
  });

  it("states no return when a returned row is undated and no completion event exists", () => {
    // The undated item came back at a moment nothing recorded, possibly after
    // the dated one, so the dated row is not the booking's return.
    const moments = resolveReceiptMoments({
      rows: finishedRows([
        slice({
          bookingAssetId: "ba-1",
          checkedOutAt: CHECKED_OUT_AT,
          checkedInAt: EARLIER,
          checkedInById: "user-2",
        }),
        slice({
          bookingAssetId: "ba-2",
          assetId: "asset-2",
          checkedOutAt: CHECKED_OUT_AT,
        }),
      ]),
      departures: [],
      completedAt: null,
    });

    expect(moments.returnedAt).toBeNull();
  });

  it("does not wait for a date on a row whose units were all written off", () => {
    // Accounted for, nothing returned: there is no return for it to date.
    const moments = resolveReceiptMoments({
      rows: finishedRows(
        [
          slice({
            bookingAssetId: "ba-consumed",
            assetId: "asset-qty",
            assetType: AssetType.QUANTITY_TRACKED,
            quantity: 5,
            checkedOutAt: CHECKED_OUT_AT,
            checkedOutQuantity: 5,
          }),
          slice({
            bookingAssetId: "ba-1",
            checkedOutAt: CHECKED_OUT_AT,
            checkedInAt: EARLIER,
            checkedInById: "user-2",
          }),
          slice({
            bookingAssetId: "ba-2",
            assetId: "asset-2",
            checkedOutAt: CHECKED_OUT_AT,
            checkedInAt: CHECKED_IN_AT,
            checkedInById: "user-2",
          }),
        ],
        new Map([["ba-consumed", breakdown({ consumed: 5 })]])
      ),
      departures: [],
      completedAt: null,
    });

    expect(moments.returnedAt).toEqual(CHECKED_IN_AT);
    expect(moments.checkedInByIds).toEqual(["user-2"]);
  });

  it("names no receivers when a returned row records none", () => {
    // The header would otherwise name a person above an item nobody is
    // recorded receiving; each row still prints its own name.
    const moments = resolveReceiptMoments({
      rows: finishedRows([
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
          checkedInAt: CHECKED_IN_AT,
          checkedInById: null,
        }),
      ]),
      departures: [],
      completedAt: CHECKED_IN_AT,
    });

    expect(moments.checkedInByIds).toEqual([]);
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

describe("summariseCheckinMethods", () => {
  it("gives one line when every returned row came back the same way", () => {
    expect(
      summariseCheckinMethods([
        {
          state: "RETURNED",
          checkedInHow: "Scanned on the phone",
          checkedInAt: CHECKED_IN_AT,
        },
        {
          state: "RETURNED",
          checkedInHow: "Scanned on the phone",
          checkedInAt: CHECKED_IN_AT,
        },
        // A row that never came back has no method and does not break the
        // agreement.
        { state: "STILL_OUT", checkedInHow: null, checkedInAt: null },
      ])
    ).toBe("Scanned on the phone");
  });

  it("gives nothing when the returned rows disagree, so each prints its own", () => {
    expect(
      summariseCheckinMethods([
        {
          state: "RETURNED",
          checkedInHow: "Scanned on the phone",
          checkedInAt: CHECKED_IN_AT,
        },
        {
          state: "RETURNED",
          checkedInHow: "Selected on the web",
          checkedInAt: CHECKED_IN_AT,
        },
      ])
    ).toBeNull();
  });

  it("counts a returned row that nothing dated", () => {
    // Its check-in recorded how, even though no marker recorded when. A header
    // line from the dated rows alone would claim it came back their way.
    expect(
      summariseCheckinMethods([
        {
          state: "RETURNED",
          checkedInHow: "Scanned on the phone",
          checkedInAt: CHECKED_IN_AT,
        },
        {
          state: "RETURNED",
          checkedInHow: "In one click on the web",
          checkedInAt: null,
        },
      ])
    ).toBeNull();
  });

  it("gives nothing when a returned row recorded no method", () => {
    // why: a return made before methods were recorded, next to one that was.
    // A header line would claim the unrecorded row came back the same way.
    expect(
      summariseCheckinMethods([
        {
          state: "RETURNED",
          checkedInHow: "Scanned on the phone",
          checkedInAt: CHECKED_IN_AT,
        },
        { state: "RETURNED", checkedInHow: null, checkedInAt: CHECKED_IN_AT },
      ])
    ).toBeNull();
  });

  it("gives nothing when no row recorded a method", () => {
    expect(
      summariseCheckinMethods([
        { state: "RETURNED", checkedInHow: null, checkedInAt: CHECKED_IN_AT },
      ])
    ).toBeNull();
    expect(summariseCheckinMethods([])).toBeNull();
  });
});
