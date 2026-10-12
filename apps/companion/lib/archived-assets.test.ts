/**
 * Tests for the archived-asset helpers.
 *
 * These run under Node's test runner via tsx, so this file and the module it
 * tests must not import React Native, Expo, or `@/`-aliased paths.
 *
 * @see ./archived-assets.ts
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  archivedAssetReason,
  archivedAssetsInBookingReason,
  archivedIdsFromError,
  assetBadgeStatus,
  droppedArchivedNote,
  isArchivedAsset,
  markArchivedRows,
} from "./archived-assets";

test("an asset with an archive stamp is archived", () => {
  assert.equal(
    isArchivedAsset({ archivedAt: "2026-10-09T13:44:00.000Z" }),
    true
  );
});

test("an active asset, or one from a server that predates archiving, is not", () => {
  assert.equal(isArchivedAsset({ archivedAt: null }), false);
  assert.equal(isArchivedAsset({}), false);
  assert.equal(isArchivedAsset(null), false);
});

test("the badge says Archived instead of the live status", () => {
  assert.equal(
    assetBadgeStatus({
      status: "AVAILABLE",
      archivedAt: "2026-10-09T13:44:00.000Z",
    }),
    "ARCHIVED"
  );
  assert.equal(
    assetBadgeStatus({ status: "IN_CUSTODY", archivedAt: null }),
    "IN_CUSTODY"
  );
});

test("admins are told to reinstate, everyone else to ask an admin", () => {
  assert.equal(
    archivedAssetReason({ canReinstate: true }),
    "This asset is archived. Reinstate it to make changes."
  );
  assert.equal(
    archivedAssetReason({ canReinstate: false }),
    "This asset is archived. Ask an admin to reinstate it."
  );
});

test("the reserve reason names the archived assets and fits the reader", () => {
  assert.equal(
    archivedAssetsInBookingReason(["Old camera"], { canReinstate: true }),
    '"Old camera" is archived. Remove it from the booking or reinstate it.'
  );
  assert.equal(
    archivedAssetsInBookingReason(["Old camera", "Old lens"], {
      canReinstate: false,
    }),
    '"Old camera" and "Old lens" are archived. Remove them from the booking or ask an admin to reinstate them.'
  );
});

test("a long list names three and counts the rest", () => {
  assert.equal(
    archivedAssetsInBookingReason(["A", "B", "C", "D", "E"], {
      canReinstate: true,
    }),
    '"A", "B", "C" and 2 more are archived. Remove them from the booking or reinstate them.'
  );
});

test("a duplicate that dropped nothing says nothing", () => {
  assert.equal(droppedArchivedNote(0), null);
  assert.equal(droppedArchivedNote(undefined), null);
  assert.equal(
    droppedArchivedNote(1),
    "1 archived asset was left out of the copy. Archived assets can't be booked."
  );
  assert.equal(
    droppedArchivedNote(3),
    "3 archived assets were left out of the copy. Archived assets can't be booked."
  );
});

test("only an archived refusal names archived ids", () => {
  assert.deepEqual(
    archivedIdsFromError({ reason: "archived", archivedAssetIds: ["a", "b"] }),
    ["a", "b"]
  );
  // Another refusal, or a server that predates the field, names none.
  assert.deepEqual(
    archivedIdsFromError({ reason: "unclaimed", archivedAssetIds: ["a"] }),
    []
  );
  assert.deepEqual(archivedIdsFromError({ reason: "archived" }), []);
  assert.deepEqual(archivedIdsFromError(null), []);
});

test("a refusal marks only the asset rows it names as archived", () => {
  // A fulfil, add-to-booking or location submit the server refused because
  // one row was archived after it was scanned.
  const rows = [
    { type: "asset" as const, targetId: "asset-1", title: "Old camera" },
    { type: "asset" as const, targetId: "asset-2", title: "Tripod" },
    {
      type: "kit" as const,
      targetId: "asset-1",
      title: "Kit with a clashing id",
    },
  ];
  assert.deepEqual(markArchivedRows(rows, ["asset-1"]), [
    {
      type: "asset",
      targetId: "asset-1",
      title: "Old camera",
      archived: true,
      submitError: "Archived. Remove it from the list.",
    },
    { type: "asset", targetId: "asset-2", title: "Tripod" },
    // A kit row is never an archived asset, whatever its id.
    { type: "kit", targetId: "asset-1", title: "Kit with a clashing id" },
  ]);
});

test("an archived refusal clears the errors an earlier submit left on the other rows", () => {
  const rows = [
    { type: "asset" as const, targetId: "asset-1" },
    {
      type: "asset" as const,
      targetId: "asset-2",
      submitError: "Only 2 units are free.",
    },
  ];
  assert.deepEqual(
    markArchivedRows(rows, ["asset-1"]).map((row) => row.submitError),
    ["Archived. Remove it from the list.", undefined]
  );
});

test("a refusal that names no archived rows leaves the list as it was", () => {
  const rows = [{ type: "asset" as const, targetId: "asset-1" }];
  assert.equal(markArchivedRows(rows, []), rows);
});
