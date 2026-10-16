import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { WITHHELD_CUSTODIAN_NAME } from "@shelf/labels";
import type { AssetBookingRow } from "@/lib/api/types";

import {
  BOOKINGS_PREVIEW_COUNT,
  buildAssetBookingsView,
  custodianLabel,
} from "./asset-bookings-view";

/**
 * A row in the exact shape `GET /api/mobile/assets/:assetId/bookings` emits,
 * which the webapp route test pins from the producer side.
 */
function row(id: string, status = "RESERVED"): AssetBookingRow {
  return {
    id,
    name: `Booking ${id}`,
    status: status as AssetBookingRow["status"],
    from: "2026-10-01T09:00:00.000Z",
    to: "2026-10-02T09:00:00.000Z",
    custodianName: "Sam",
  };
}

/** Builds rows b1..bN. */
function rows(n: number): AssetBookingRow[] {
  return Array.from({ length: n }, (_, i) => row(`b${i + 1}`));
}

/** The ids a view draws, in order. */
function ids(view: { rows: AssetBookingRow[] }) {
  return view.rows.map((b) => b.id);
}

describe("buildAssetBookingsView", () => {
  it("shows nothing for an asset that was never booked", () => {
    const view = buildAssetBookingsView({
      bookings: [],
      activeBookings: [],
      totalCount: 0,
      showAll: false,
    });

    assert.deepEqual(view, {
      rows: [],
      hiddenCount: 0,
      loadedCount: 0,
      isTruncated: false,
    });
  });

  it("shows every row when there are no more than the preview holds", () => {
    const view = buildAssetBookingsView({
      bookings: rows(BOOKINGS_PREVIEW_COUNT),
      activeBookings: [],
      totalCount: BOOKINGS_PREVIEW_COUNT,
      showAll: false,
    });

    assert.equal(view.rows.length, BOOKINGS_PREVIEW_COUNT);
    assert.equal(view.hiddenCount, 0);
  });

  it("hides the rows past the preview behind a count", () => {
    const view = buildAssetBookingsView({
      bookings: rows(4),
      activeBookings: [],
      totalCount: 4,
      showAll: false,
    });

    assert.deepEqual(ids(view), ["b1", "b2", "b3"]);
    assert.equal(view.hiddenCount, 1);
  });

  it("shows every loaded row once expanded", () => {
    const view = buildAssetBookingsView({
      bookings: rows(4),
      activeBookings: [],
      totalCount: 4,
      showAll: true,
    });

    assert.equal(view.rows.length, 4);
    assert.equal(view.hiddenCount, 0);
  });

  it("leads with the booking the asset is out on now, ahead of future reservations", () => {
    // The page is newest start first, so three future reservations fill the
    // preview; the current booking sits further down or on another page.
    const view = buildAssetBookingsView({
      bookings: [row("f1"), row("f2"), row("f3"), row("now", "ONGOING")],
      activeBookings: [row("now", "ONGOING")],
      totalCount: 4,
      showAll: false,
    });

    assert.deepEqual(ids(view), ["now", "f1", "f2"]);
  });

  it("draws an active booking once when the page holds it too", () => {
    const view = buildAssetBookingsView({
      bookings: [row("now", "OVERDUE"), row("past", "COMPLETE")],
      activeBookings: [row("now", "OVERDUE")],
      totalCount: 2,
      showAll: true,
    });

    assert.deepEqual(ids(view), ["now", "past"]);
    assert.equal(view.loadedCount, 2);
  });

  it("counts an active booking from beyond the page as loaded", () => {
    const view = buildAssetBookingsView({
      bookings: rows(20),
      activeBookings: [row("now", "ONGOING")],
      totalCount: 21,
      showAll: true,
    });

    assert.equal(view.loadedCount, 21);
    assert.equal(view.isTruncated, false);
  });

  it("reports a list cut short of the asset's history", () => {
    const view = buildAssetBookingsView({
      bookings: rows(20),
      activeBookings: [],
      totalCount: 60,
      showAll: true,
    });

    assert.equal(view.isTruncated, true);
    assert.equal(view.loadedCount, 20);
  });

  it("does not report a full list as cut short", () => {
    const view = buildAssetBookingsView({
      bookings: rows(20),
      activeBookings: [],
      totalCount: 20,
      showAll: false,
    });

    assert.equal(view.isTruncated, false);
  });
});

describe("custodianLabel", () => {
  it("names a visible custodian", () => {
    assert.deepEqual(custodianLabel("Sam"), { text: "Sam", isWithheld: false });
  });

  it("flags a withheld custodian so it is not drawn as a name", () => {
    assert.deepEqual(custodianLabel(WITHHELD_CUSTODIAN_NAME), {
      text: WITHHELD_CUSTODIAN_NAME,
      isWithheld: true,
    });
  });

  it("has no label for a booking without a custodian", () => {
    assert.equal(custodianLabel(null), null);
  });
});
