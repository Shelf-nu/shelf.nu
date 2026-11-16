/**
 * Tests for the booking detail screen's search.
 *
 * These run under Node's test runner via tsx, so this file and the module it
 * tests must not import React Native, Expo, or `@/`-aliased paths.
 *
 * @see ./booking-search.ts
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { buildBookingRows } from "./booking-kit-rows";
import { filterBookingAssets } from "./booking-search";
import type { BookingAsset, BookingKit } from "./api/types";

/**
 * A booking asset as the endpoint sends it: standalone, uncategorised and
 * unplaced unless `overrides` says otherwise.
 */
function asset(
  overrides: Partial<BookingAsset> & { id: string }
): BookingAsset {
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

/** An asset booked as a member of `kit`, carrying the kit id and name. */
function member(
  overrides: Partial<BookingAsset> & { id: string },
  kit: BookingKit
): BookingAsset {
  return asset({
    kitId: kit.id,
    kit: { id: kit.id, name: kit.name },
    ...overrides,
  });
}

/** A kit record as the endpoint sends it in `booking.kits`, without an image. */
function kitRecord(
  overrides: Partial<BookingKit> & { id: string; name: string }
): BookingKit {
  return {
    status: "AVAILABLE",
    image: null,
    imageExpiration: null,
    category: null,
    location: null,
    assetCount: 3,
    ...overrides,
  };
}

const cameraKit = kitRecord({
  id: "kit-camera",
  name: "Camera Kit",
  category: { id: "cat-video", name: "Video", color: "#000000" },
  location: { id: "loc-cage", name: "Equipment Cage" },
});

const audioKit = kitRecord({ id: "kit-audio", name: "Audio Package" });

const tripod = asset({
  id: "tripod",
  title: "Carbon Tripod",
  category: { id: "cat-support", name: "Support", color: "#111111" },
  location: { id: "loc-store", name: "Main Store" },
});
const light = asset({
  id: "light",
  title: "LED Panel",
  location: { id: "loc-van", name: "Van 2" },
});
const body = member({ id: "body", title: "Mirrorless Body" }, cameraKit);
const lens = member({ id: "lens", title: "Zoom Lens" }, cameraKit);
const battery = member({ id: "battery", title: "Spare Battery" }, cameraKit);
const mic = member({ id: "mic", title: "Shotgun Mic" }, audioKit);

const assets = [tripod, body, light, lens, mic, battery];
const kits = [cameraKit, audioKit];

/** The ids a search of `list`, with the booking's kits, returns in order. */
function idsFound(term: string, list: BookingAsset[] = assets) {
  return filterBookingAssets(list, kits, term).map((a) => a.id);
}

// ---------------------------------------------------------------------------
// What a term finds
// ---------------------------------------------------------------------------

test("a blank term returns the list itself", () => {
  assert.equal(filterBookingAssets(assets, kits, ""), assets);
  assert.equal(filterBookingAssets(assets, kits, "   "), assets);
});

test("a title matches in any case, with the term trimmed", () => {
  assert.deepEqual(idsFound("  carbon TRIPOD "), ["tripod"]);
});

test("an asset's category finds it", () => {
  assert.deepEqual(idsFound("support"), ["tripod"]);
});

test("an asset's own location finds it", () => {
  assert.deepEqual(idsFound("van 2"), ["light"]);
});

test("a kit's name brings back every member of the kit", () => {
  assert.deepEqual(idsFound("camera kit"), ["body", "lens", "battery"]);
});

test("a kit's location finds its members, as the kit header shows it", () => {
  // No member carries a location of its own here; the kit record does.
  assert.deepEqual(idsFound("equipment cage"), ["body", "lens", "battery"]);
});

test("a kit's category finds its members", () => {
  assert.deepEqual(idsFound("video"), ["body", "lens", "battery"]);
});

test("one member's title brings back the whole kit", () => {
  // A kit is one thing on this screen: it comes back whole or not at all.
  assert.deepEqual(idsFound("zoom lens"), ["body", "lens", "battery"]);
});

test("results keep the server's order", () => {
  // "o" is in every asset here but the LED panel (for the spare battery, only
  // in its kit's category), and they come back in the order they were sent.
  assert.deepEqual(idsFound("o"), ["tripod", "body", "lens", "mic", "battery"]);
});

test("a term that matches nothing returns an empty list", () => {
  assert.deepEqual(idsFound("projector"), []);
});

test("a kit named on a slice finds an asset that stands on its own", () => {
  // A quantity-tracked asset booked standalone AND through a kit has no single
  // kit (`kitId: null`) but lists each slice's kit on its row.
  const cables = asset({
    id: "cables",
    title: "XLR Cable",
    type: "QUANTITY_TRACKED",
    slices: [
      { bookingAssetId: "ba-1", quantity: 4, assetKitId: null, kit: null },
      {
        bookingAssetId: "ba-2",
        quantity: 2,
        assetKitId: "ak-9",
        kit: { id: "kit-audio", name: "Audio Package" },
      },
    ],
  });

  // Found by the kit it names, alongside that kit's own member; it pulls no
  // one in, because it belongs to no kit group itself.
  assert.deepEqual(idsFound("audio package", [...assets, cables]), [
    "mic",
    "cables",
  ]);
});

// ---------------------------------------------------------------------------
// Payloads from an older server
// ---------------------------------------------------------------------------

test("a payload with no location and no kits still searches what it has", () => {
  // An older server sends neither `location` on assets nor `booking.kits`.
  const oldPayload: BookingAsset[] = [
    asset({ id: "tripod", title: "Carbon Tripod" }),
    member({ id: "body", title: "Mirrorless Body" }, cameraKit),
    member({ id: "lens", title: "Zoom Lens" }, cameraKit),
  ];
  assert.equal("location" in oldPayload[0], false);
  const found = (term: string) =>
    filterBookingAssets(oldPayload, undefined, term).map((a) => a.id);

  assert.deepEqual(found("tripod"), ["tripod"]);
  assert.deepEqual(found("camera kit"), ["body", "lens"]);
  // Without the kit record, the kit's location is not known.
  assert.deepEqual(found("equipment cage"), []);
});

// ---------------------------------------------------------------------------
// What the list builds from a result
// ---------------------------------------------------------------------------

test("a found kit's header still counts every member the booking holds", () => {
  const rows = buildBookingRows({
    assets: filterBookingAssets(assets, kits, "spare battery"),
    kits,
    expandedKitIds: new Set(),
  });

  assert.equal(rows.length, 1);
  const [header] = rows;
  assert.equal(header.type, "kit");
  assert.deepEqual(header.type === "kit" && header.members.map((m) => m.id), [
    "body",
    "lens",
    "battery",
  ]);
});

test("a kit with no member found drops out of the list", () => {
  const rows = buildBookingRows({
    assets: filterBookingAssets(assets, kits, "shotgun"),
    kits,
    expandedKitIds: new Set(),
  });

  assert.deepEqual(
    rows.map((row) => (row.type === "kit" ? `kit:${row.kitId}` : row.type)),
    ["kit:kit-audio"]
  );
});
