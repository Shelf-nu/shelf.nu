/**
 * Enum-parity regression guard.
 *
 * The package deliberately re-declares its `Qt*` string-union enums instead of
 * importing `@prisma/client` (zero runtime deps, Metro-safe). That freedom is
 * only safe if the literals stay byte-identical to the database enums, so this
 * test pins each `QT_*` runtime array against a list COPIED BY HAND from
 * `packages/database/prisma/schema.prisma`. If the schema gains/loses/renames
 * an enum value, this test fails until both the package union and this copied
 * list are reconciled — the cheap drift guard the plan calls for.
 *
 * @see {@link file://../../database/prisma/schema.prisma}
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  QT_ASSET_TYPES,
  QT_BOOKING_STATUSES,
  QT_CONSUMPTION_CATEGORIES,
  QT_CONSUMPTION_TYPES,
} from "./types.js";

/** Compares two string lists as sets (order-independent, duplicate-free). */
function assertSameSet(actual: readonly string[], expected: readonly string[]) {
  assert.deepEqual([...new Set(actual)].sort(), [...new Set(expected)].sort());
}

// ---------------------------------------------------------------------------
// The right-hand lists below are hand-copied from schema.prisma. Update BOTH
// the package union AND the list here whenever the schema enum changes.
// ---------------------------------------------------------------------------

test("QT_ASSET_TYPES equals schema AssetType", () => {
  // enum AssetType { INDIVIDUAL, QUANTITY_TRACKED }
  assertSameSet(QT_ASSET_TYPES, ["INDIVIDUAL", "QUANTITY_TRACKED"]);
});

test("QT_CONSUMPTION_TYPES equals schema ConsumptionType", () => {
  // enum ConsumptionType { ONE_WAY, TWO_WAY }
  assertSameSet(QT_CONSUMPTION_TYPES, ["ONE_WAY", "TWO_WAY"]);
});

test("QT_CONSUMPTION_CATEGORIES equals schema ConsumptionCategory", () => {
  // enum ConsumptionCategory { CHECKOUT, RETURN, RESTOCK, ADJUSTMENT, LOSS, CONSUME, DAMAGE }
  assertSameSet(QT_CONSUMPTION_CATEGORIES, [
    "CHECKOUT",
    "RETURN",
    "RESTOCK",
    "ADJUSTMENT",
    "LOSS",
    "CONSUME",
    "DAMAGE",
  ]);
});

test("QT_BOOKING_STATUSES equals schema BookingStatus", () => {
  // enum BookingStatus { DRAFT, RESERVED, ONGOING, OVERDUE, COMPLETE, ARCHIVED, CANCELLED }
  assertSameSet(QT_BOOKING_STATUSES, [
    "DRAFT",
    "RESERVED",
    "ONGOING",
    "OVERDUE",
    "COMPLETE",
    "ARCHIVED",
    "CANCELLED",
  ]);
});

test("no QT_* array has duplicate members", () => {
  for (const arr of [
    QT_ASSET_TYPES,
    QT_CONSUMPTION_TYPES,
    QT_CONSUMPTION_CATEGORIES,
    QT_BOOKING_STATUSES,
  ]) {
    assert.equal(new Set(arr).size, arr.length);
  }
});
