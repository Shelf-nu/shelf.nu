/**
 * Tests for the batch scan blocker rules.
 *
 * These run under Node's test runner via tsx, so this file and the module it
 * tests must not import React Native, Expo, or `@/`-aliased paths.
 *
 * The add/fulfil split is the contract under test: a plain add sends kit
 * members through the kit ("scan the kit to add it as a whole"), while fulfil
 * matches CONCRETE units against the booking's model lines — an asset living
 * in a kit is a perfectly good fulfil scan, so that rule must not fire there.
 *
 * @see ./batch-blockers.ts
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  computeBlockers,
  type BlockableItem,
  type BookingBlockerContext,
} from "./batch-blockers";

const kitMember: BlockableItem = {
  qrId: "qr-1",
  type: "asset",
  targetId: "asset-1",
  title: "Dell Laptop",
  status: "AVAILABLE",
  kitId: "kit-9",
  hasAssetsInCustody: false,
  hasUnavailableAssets: false,
  availableToBook: true,
};

const ctx: BookingBlockerContext = {
  bookingStatus: "RESERVED",
  bookedAssetIds: new Set(),
};

test("booking_add blocks an asset that lives in a kit", () => {
  const groups = computeBlockers("booking_add", [kitMember], ctx);
  assert.ok(groups.some((g) => g.key === "asset-part-of-kit"));
});

test("booking_fulfil accepts an asset that lives in a kit", () => {
  const groups = computeBlockers("booking_fulfil", [kitMember], ctx);
  assert.equal(
    groups.find((g) => g.key === "asset-part-of-kit"),
    undefined
  );
});

test("booking_fulfil keeps the rules that are not about kit membership", () => {
  const notBookable: BlockableItem = {
    ...kitMember,
    qrId: "qr-2",
    targetId: "asset-2",
    kitId: null,
    availableToBook: false,
  };
  const groups = computeBlockers("booking_fulfil", [notBookable], ctx);
  assert.ok(groups.some((g) => g.key === "asset-not-bookable"));
});
