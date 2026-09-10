/**
 * Tests for the booking check-out scan eligibility rules.
 *
 * These run under Node's test runner via tsx, so this file and the module it
 * tests must not import React Native, Expo, or `@/`-aliased paths.
 *
 * Two contracts carry most of the weight here. A quantity-tracked row is
 * judged by its remaining booked units and only falls back to the global
 * status when the server sent no count, so a partly-checked-out asset stays
 * scannable. And a kit's membership comes from the kit payload as well as the
 * booking rows, because a kit added from the phone is stored as standalone
 * rows whose `kitId` is null.
 *
 * @see ./booking-scan-eligibility.ts
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  checkoutBlocker,
  eligibleKitMembers,
  type CheckoutEligibilityContext,
} from "./booking-scan-eligibility";
import type { BookingAsset } from "./api/types";

function row(overrides: Partial<BookingAsset> & { id: string }): BookingAsset {
  return {
    title: `Asset ${overrides.id}`,
    status: "AVAILABLE",
    mainImage: null,
    kitId: null,
    category: null,
    kit: null,
    ...overrides,
  };
}

function ctxOf(
  rows: BookingAsset[],
  checkedInIds: string[] = []
): CheckoutEligibilityContext {
  return {
    bookedAssetIds: new Set(rows.map((r) => r.id)),
    checkedInAssetIds: new Set(checkedInIds),
    bookedAssets: rows,
  };
}

// ── checkoutBlocker ─────────────────────────────────────

test("accepts an available asset that is on the booking", () => {
  const ctx = ctxOf([row({ id: "a1" })]);
  assert.equal(checkoutBlocker({ id: "a1", title: "Tripod" }, ctx), null);
});

test("rejects an asset that is not on the booking", () => {
  const ctx = ctxOf([row({ id: "a1" })]);
  const blocker = checkoutBlocker({ id: "other", title: "Tripod" }, ctx);
  assert.equal(blocker?.title, "Not in This Booking");
  assert.match(blocker!.message, /not part of this booking/);
});

test("rejects an asset already returned on this booking", () => {
  const ctx = ctxOf([row({ id: "a1", status: "CHECKED_OUT" })], ["a1"]);
  assert.equal(
    checkoutBlocker({ id: "a1", title: "Tripod" }, ctx)?.title,
    "Already Returned"
  );
});

test("rejects an asset held in custody", () => {
  const ctx = ctxOf([row({ id: "a1", status: "IN_CUSTODY" })]);
  const blocker = checkoutBlocker({ id: "a1", title: "Tripod" }, ctx);
  assert.equal(blocker?.title, "In Custody");
  assert.match(blocker!.message, /release custody first/);
});

test("rejects an asset that is already checked out", () => {
  const ctx = ctxOf([row({ id: "a1", status: "CHECKED_OUT" })]);
  assert.equal(
    checkoutBlocker({ id: "a1", title: "Tripod" }, ctx)?.title,
    "Already Checked Out"
  );
});

test("accepts a quantity-tracked asset with units still to take", () => {
  const ctx = ctxOf([
    row({
      id: "qt1",
      status: "CHECKED_OUT",
      type: "QUANTITY_TRACKED",
      remainingToCheckOut: 3,
    }),
  ]);
  // Partly out already, so the global status reads CHECKED_OUT — the booked
  // units left are what decides.
  assert.equal(checkoutBlocker({ id: "qt1", title: "Cable" }, ctx), null);
});

test("rejects a quantity-tracked asset with no units left to take", () => {
  const ctx = ctxOf([
    row({
      id: "qt1",
      status: "AVAILABLE",
      type: "QUANTITY_TRACKED",
      remainingToCheckOut: 0,
    }),
  ]);
  const blocker = checkoutBlocker({ id: "qt1", title: "Cable" }, ctx);
  assert.equal(blocker?.title, "Already Checked Out");
  assert.match(blocker!.message, /no units left/);
});

test("takes remaining units even when some were already returned here", () => {
  // A partial check-in records the whole asset id, so the returned set says
  // nothing about how many units are still reserved.
  const ctx = ctxOf(
    [
      row({
        id: "qt1",
        status: "AVAILABLE",
        type: "QUANTITY_TRACKED",
        remainingToCheckOut: 2,
      }),
    ],
    ["qt1"]
  );
  assert.equal(checkoutBlocker({ id: "qt1", title: "Cable" }, ctx), null);
});

test("takes remaining units of a quantity-tracked asset held in custody", () => {
  // Custody on a pooled asset allocates some units to an operator; the server
  // rejects custody only for individual assets.
  const ctx = ctxOf([
    row({
      id: "qt1",
      status: "IN_CUSTODY",
      type: "QUANTITY_TRACKED",
      remainingToCheckOut: 4,
    }),
  ]);
  assert.equal(checkoutBlocker({ id: "qt1", title: "Cable" }, ctx), null);
});

test("falls back to status when a quantity-tracked row carries no count", () => {
  const ctx = ctxOf([
    row({ id: "qt1", status: "CHECKED_OUT", type: "QUANTITY_TRACKED" }),
  ]);
  assert.equal(
    checkoutBlocker({ id: "qt1", title: "Cable" }, ctx)?.title,
    "Already Checked Out"
  );
});

// ── eligibleKitMembers ──────────────────────────────────

const kit = { id: "kit-1", name: "Camera Rig", assets: [{ id: "a1" }] };

test("expands a kit into its bookable members", () => {
  const ctx = ctxOf([row({ id: "a1" }), row({ id: "a2" })]);
  const { eligible, reason } = eligibleKitMembers(kit, ctx, new Set());
  assert.equal(reason, null);
  assert.deepEqual(
    eligible.map((r) => r.id),
    ["a1"]
  );
});

test("finds a member through the kit payload when the row has no kit link", () => {
  // A kit added from the phone is stored as standalone rows, so `kitId` is
  // null on every member and only the kit's own payload names them.
  const ctx = ctxOf([row({ id: "a1", kitId: null })]);
  const { eligible } = eligibleKitMembers(kit, ctx, new Set());
  assert.deepEqual(
    eligible.map((r) => r.id),
    ["a1"]
  );
});

test("finds a member through the row's kit link when the payload omits it", () => {
  const ctx = ctxOf([row({ id: "a9", kitId: "kit-1" })]);
  const { eligible } = eligibleKitMembers(kit, ctx, new Set());
  assert.deepEqual(
    eligible.map((r) => r.id),
    ["a9"]
  );
});

test("reports a kit with no members on the booking", () => {
  const ctx = ctxOf([row({ id: "unrelated" })]);
  const { eligible, reason } = eligibleKitMembers(kit, ctx, new Set());
  assert.equal(eligible.length, 0);
  assert.equal(reason?.title, "Not in This Booking");
});

test("reports a kit whose members are all already checked out", () => {
  const ctx = ctxOf([row({ id: "a1", status: "CHECKED_OUT" })]);
  const { eligible, reason } = eligibleKitMembers(kit, ctx, new Set());
  assert.equal(eligible.length, 0);
  assert.equal(reason?.title, "Already Checked Out");
});

test("reports the members' own reason when a kit is blocked for one cause", () => {
  // Custody carries a remedy; reporting "already checked out" would send the
  // operator looking for the wrong thing.
  const ctx = ctxOf([row({ id: "a1", status: "IN_CUSTODY" })]);
  const { eligible, reason } = eligibleKitMembers(kit, ctx, new Set());
  assert.equal(eligible.length, 0);
  assert.equal(reason?.title, "In Custody");
  assert.match(reason!.message, /release custody first/);
});

test("falls back to a neutral reason when members are blocked differently", () => {
  const ctx = ctxOf(
    [
      row({ id: "a1", status: "IN_CUSTODY" }),
      row({ id: "a2", status: "CHECKED_OUT", kitId: "kit-1" }),
    ],
    []
  );
  const { eligible, reason } = eligibleKitMembers(
    { id: "kit-1", name: "Camera Rig", assets: [{ id: "a1" }, { id: "a2" }] },
    ctx,
    new Set()
  );
  assert.equal(eligible.length, 0);
  assert.equal(reason?.title, "Not Available");
});

test("reports a kit whose eligible members are already in the list", () => {
  const ctx = ctxOf([row({ id: "a1" })]);
  const { eligible, reason } = eligibleKitMembers(kit, ctx, new Set(["a1"]));
  assert.equal(eligible.length, 0);
  assert.equal(reason?.title, "Already Covered");
});
