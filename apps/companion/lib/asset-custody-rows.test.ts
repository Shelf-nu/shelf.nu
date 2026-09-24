/**
 * Tests for the asset detail screen's "custody through a booking" rows.
 *
 * These run under Node's test runner via tsx, so this file and the module it
 * tests must not import React Native, Expo, or `@/`-aliased paths.
 *
 * The fixture has the shape the detail endpoint sends as `activeBooking`; the
 * webapp's route test pins the same shape from the producer side.
 *
 * @see ./asset-custody-rows.ts
 * @see ../../webapp/test/routes-tests/api+/mobile.assets.assetId.test.ts
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  buildBookingCustodyRows,
  type CustodyInfoRow,
} from "./asset-custody-rows";
import type { AssetDetail } from "./api/types";

type ActiveBooking = NonNullable<AssetDetail["activeBooking"]>;

/** The detail endpoint's `activeBooking`, as it arrives over the wire. */
function activeBooking(overrides: Partial<ActiveBooking> = {}): ActiveBooking {
  return {
    id: "booking-1",
    name: "Field shoot",
    from: "2026-03-02T09:30:00.000Z",
    custodianName: "Caz",
    canOpen: true,
    ...overrides,
  };
}

/**
 * Builds the rows with a stand-in date formatter, recording every booking the
 * rows open.
 */
function build(input: AssetDetail["activeBooking"]) {
  const opened: string[] = [];
  const rows = buildBookingCustodyRows(input, {
    formatDateTime: (iso) => `at ${iso}`,
    onOpenBooking: (bookingId) => {
      opened.push(bookingId);
    },
  });
  return { rows, opened };
}

/** A row with its press handler reduced to whether it has one. */
function withoutHandler({ onPress, ...row }: CustodyInfoRow) {
  return { ...row, tappable: onPress !== undefined };
}

test("shows who holds the asset, through which booking, and since when", () => {
  const { rows, opened } = build(activeBooking());

  assert.deepEqual(rows.map(withoutHandler), [
    {
      key: "booking-custodian",
      icon: "person-outline",
      label: "In Custody Of",
      value: "Caz",
      tappable: false,
    },
    {
      key: "booking",
      icon: "calendar-outline",
      label: "Via Booking",
      value: "Field shoot",
      accessibilityLabel: "View booking Field shoot",
      tappable: true,
    },
    {
      key: "booking-since",
      icon: "time-outline",
      label: "Since",
      value: "at 2026-03-02T09:30:00.000Z",
      tappable: false,
    },
  ]);

  rows[1]?.onPress?.();
  assert.deepEqual(opened, ["booking-1"]);
});

test("omits the holder row when the booking has no custodian", () => {
  const { rows } = build(activeBooking({ custodianName: null }));

  assert.deepEqual(
    rows.map((row) => row.label),
    ["Via Booking", "Since"]
  );
});

test("gives the booking row no press handler when the viewer may not open it", () => {
  const { rows } = build(activeBooking({ canOpen: false }));
  const bookingRow = rows.find((row) => row.label === "Via Booking");

  assert.ok(bookingRow);
  assert.equal(bookingRow.value, "Field shoot");
  assert.equal(bookingRow.onPress, undefined);
  assert.equal(bookingRow.accessibilityLabel, undefined);
  // The other rows still render
  assert.deepEqual(
    rows.map((row) => row.label),
    ["In Custody Of", "Via Booking", "Since"]
  );
});

test("renders no rows when the server sends no booking", () => {
  assert.deepEqual(build(null).rows, []);
});

test("renders no rows when a server too old to send the field omits it", () => {
  assert.deepEqual(build(undefined).rows, []);
});
