/**
 * Tests for the booking detail's kit grouping rules.
 *
 * These run under Node's test runner via tsx, so this file and the module it
 * tests must not import React Native, Expo, or `@/`-aliased paths.
 *
 * The rules under test are the ones a screenshot cannot check: which kit a
 * quantity-tracked asset is grouped under when its slices disagree, what a
 * kit's badge says on a booking that is over, and when a removal may name the
 * kit instead of listing its assets.
 *
 * @see ./booking-kit-rows.ts
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  bookingRowKey,
  buildBookingRows,
  describeBookingRows,
  describeRemoval,
  isBookingAssetSelectable,
  resolveBookingKitBadge,
  resolveKitSelectionState,
  splitRemovalSelection,
  type BookingRow,
} from "./booking-kit-rows";
import type { BookingAsset, BookingKit } from "./api/types";

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

function inKit(id: string, kitId: string, name: string): BookingAsset {
  return asset({ id, kitId, kit: { id: kitId, name } });
}

const cameraKit: BookingKit = {
  id: "kit-1",
  name: "Camera Kit",
  status: "AVAILABLE",
  image: null,
  imageExpiration: null,
  category: null,
  location: null,
  assetCount: 2,
};

// ---------------------------------------------------------------------------
// Grouping
// ---------------------------------------------------------------------------

test("a kit's header takes the place of its first member", () => {
  const rows = buildBookingRows({
    assets: [
      asset({ id: "loose-1" }),
      inKit("m1", "kit-1", "Camera Kit"),
      inKit("m2", "kit-1", "Camera Kit"),
      asset({ id: "loose-2" }),
    ],
    kits: [cameraKit],
    expandedKitIds: new Set(),
  });

  assert.deepEqual(rows.map(bookingRowKey), [
    "asset:loose-1",
    "kit:kit-1",
    "asset:loose-2",
  ]);
});

test("expanding a kit lists its members under the header", () => {
  const rows = buildBookingRows({
    assets: [
      inKit("m1", "kit-1", "Camera Kit"),
      inKit("m2", "kit-1", "Camera Kit"),
    ],
    kits: [cameraKit],
    expandedKitIds: new Set(["kit-1"]),
  });

  assert.deepEqual(rows.map(bookingRowKey), [
    "kit:kit-1",
    "asset:m1",
    "asset:m2",
    "kit-end:kit-1",
  ]);
  assert.equal(
    rows.filter((row) => row.type === "asset").every((row) => row.inKit),
    true
  );
});

test("a header carries every member, expanded or not", () => {
  const [header] = buildBookingRows({
    assets: [
      inKit("m1", "kit-1", "Camera Kit"),
      inKit("m2", "kit-1", "Camera Kit"),
    ],
    kits: [cameraKit],
    expandedKitIds: new Set(),
  });

  assert.equal(header.type, "kit");
  assert.equal(header.type === "kit" && header.members.length, 2);
});

test("an asset whose slices disagree on a kit stays standalone", () => {
  // The server reports `kitId: null` for a quantity-tracked asset booked both
  // standalone and through a kit — there is no single kit to group it under.
  const rows = buildBookingRows({
    assets: [
      asset({
        id: "qt-1",
        type: "QUANTITY_TRACKED",
        kitId: null,
        kit: null,
        slices: [
          { bookingAssetId: "ba1", quantity: 2, assetKitId: null, kit: null },
          {
            bookingAssetId: "ba2",
            quantity: 3,
            assetKitId: "ak1",
            kit: { id: "kit-1", name: "Camera Kit" },
          },
        ],
      }),
    ],
    kits: [cameraKit],
    expandedKitIds: new Set(),
  });

  assert.deepEqual(rows.map(bookingRowKey), ["asset:qt-1"]);
});

test("a kit the server did not describe still gets a header", () => {
  const [header] = buildBookingRows({
    assets: [inKit("m1", "kit-1", "Camera Kit")],
    kits: undefined,
    expandedKitIds: new Set(),
  });

  assert.equal(header.type === "kit" && header.name, "Camera Kit");
  assert.equal(header.type === "kit" && header.kit, null);
});

// ---------------------------------------------------------------------------
// Counts
// ---------------------------------------------------------------------------

test("the count names assets and kits separately", () => {
  assert.equal(
    describeBookingRows({ standaloneAssetCount: 18, kitCount: 2 }),
    "18 assets and 2 kits"
  );
  assert.equal(
    describeBookingRows({ standaloneAssetCount: 1, kitCount: 1 }),
    "1 asset and 1 kit"
  );
});

test("a booking of nothing but kits does not mention assets", () => {
  assert.equal(
    describeBookingRows({ standaloneAssetCount: 0, kitCount: 2 }),
    "2 kits"
  );
});

test("a booking with no kits at all still says how many assets", () => {
  assert.equal(
    describeBookingRows({ standaloneAssetCount: 0, kitCount: 0 }),
    "0 assets"
  );
});

// ---------------------------------------------------------------------------
// The kit badge
// ---------------------------------------------------------------------------

test("without a kit record there is nothing to badge", () => {
  assert.equal(
    resolveBookingKitBadge({
      kit: null,
      members: [inKit("m1", "kit-1", "Camera Kit")],
      bookingStatus: "RESERVED",
      checkedInAssetIds: [],
    }),
    null
  );
});

test("a reserved booking shows the kit's own status", () => {
  assert.deepEqual(
    resolveBookingKitBadge({
      kit: { ...cameraKit, status: "CHECKED_OUT" },
      members: [inKit("m1", "kit-1", "Camera Kit")],
      bookingStatus: "RESERVED",
      checkedInAssetIds: [],
    }),
    { tone: "CHECKED_OUT", label: "Checked out" }
  );
});

test("every member back on a running booking reads as already checked in", () => {
  assert.deepEqual(
    resolveBookingKitBadge({
      kit: cameraKit,
      members: [
        inKit("m1", "kit-1", "Camera Kit"),
        inKit("m2", "kit-1", "Camera Kit"),
      ],
      bookingStatus: "ONGOING",
      checkedInAssetIds: ["m1", "m2"],
    }),
    { tone: "PARTIALLY_CHECKED_IN", label: "Already checked in" }
  );
});

test("one member still out keeps the kit on its own status", () => {
  assert.deepEqual(
    resolveBookingKitBadge({
      kit: { ...cameraKit, status: "CHECKED_OUT" },
      members: [
        inKit("m1", "kit-1", "Camera Kit"),
        inKit("m2", "kit-1", "Camera Kit"),
      ],
      bookingStatus: "ONGOING",
      checkedInAssetIds: ["m1"],
    }),
    { tone: "CHECKED_OUT", label: "Checked out" }
  );
});

test("a quantity-tracked member is back when no units are left to reconcile", () => {
  const member = { ...inKit("m1", "kit-1", "Camera Kit") };
  member.type = "QUANTITY_TRACKED";
  member.quantity = 5;
  member.remainingToCheckIn = 0;
  // remainingToCheckOut returns to the booked figure once units are back, so
  // reading it here would report a fully-returned member as never gone.
  member.remainingToCheckOut = 5;

  assert.deepEqual(
    resolveBookingKitBadge({
      kit: cameraKit,
      members: [member],
      bookingStatus: "OVERDUE",
      checkedInAssetIds: [],
    }),
    { tone: "PARTIALLY_CHECKED_IN", label: "Already checked in" }
  );
});

test("a quantity-tracked member with units outstanding is not back", () => {
  const member = { ...inKit("m1", "kit-1", "Camera Kit") };
  member.type = "QUANTITY_TRACKED";
  member.quantity = 5;
  member.remainingToCheckIn = 2;

  assert.deepEqual(
    resolveBookingKitBadge({
      kit: cameraKit,
      members: [member],
      bookingStatus: "ONGOING",
      checkedInAssetIds: [],
    }),
    { tone: "AVAILABLE", label: "Available" }
  );
});

test("a finished booking with no check-out markers reads as returned", () => {
  // A single check-out action writes no per-slice records; the whole booking
  // went out.
  assert.deepEqual(
    resolveBookingKitBadge({
      kit: cameraKit,
      members: [inKit("m1", "kit-1", "Camera Kit")],
      bookingStatus: "COMPLETE",
      checkedInAssetIds: [],
      checkedOutAssetIds: [],
    }),
    { tone: "returned", label: "Returned" }
  );
});

test("a finished booking reads as returned when every member went out", () => {
  assert.deepEqual(
    resolveBookingKitBadge({
      kit: cameraKit,
      members: [
        inKit("m1", "kit-1", "Camera Kit"),
        inKit("m2", "kit-1", "Camera Kit"),
      ],
      bookingStatus: "ARCHIVED",
      checkedInAssetIds: [],
      checkedOutAssetIds: ["m1", "m2", "other"],
    }),
    { tone: "returned", label: "Returned" }
  );
});

test("a kit that never fully left a finished booking is not returned", () => {
  assert.deepEqual(
    resolveBookingKitBadge({
      kit: cameraKit,
      members: [
        inKit("m1", "kit-1", "Camera Kit"),
        inKit("m2", "kit-1", "Camera Kit"),
      ],
      bookingStatus: "COMPLETE",
      checkedInAssetIds: [],
      checkedOutAssetIds: ["m1"],
    }),
    { tone: "AVAILABLE", label: "Available" }
  );
});

// ---------------------------------------------------------------------------
// Selection
// ---------------------------------------------------------------------------

test("removal offers every row", () => {
  assert.equal(
    isBookingAssetSelectable(asset({ id: "a1" }), "remove", []),
    true
  );
});

test("check-out skips an asset that is already back", () => {
  assert.equal(
    isBookingAssetSelectable(asset({ id: "a1" }), "checkout", ["a1"]),
    false
  );
});

test("check-out offers a quantity-tracked asset with units still reserved", () => {
  assert.equal(
    isBookingAssetSelectable(
      asset({
        id: "a1",
        type: "QUANTITY_TRACKED",
        status: "AVAILABLE",
        remainingToCheckOut: 3,
      }),
      "checkout",
      []
    ),
    true
  );
});

test("a header reads as fully selected once its selectable members are", () => {
  const members = [
    asset({ id: "m1", status: "CHECKED_OUT" }),
    asset({ id: "m2", status: "AVAILABLE" }),
  ];
  // Only m1 is checkinable, so picking it alone is the whole selectable set.
  assert.equal(
    resolveKitSelectionState({
      members,
      selectMode: "checkin",
      selectedAssetIds: new Set(["m1"]),
      checkedInAssetIds: [],
    }),
    "all"
  );
});

test("a header reads as partly selected while a member is unpicked", () => {
  assert.equal(
    resolveKitSelectionState({
      members: [asset({ id: "m1" }), asset({ id: "m2" })],
      selectMode: "remove",
      selectedAssetIds: new Set(["m1"]),
      checkedInAssetIds: [],
    }),
    "some"
  );
});

test("a header whose members the mode cannot touch is unselectable", () => {
  assert.equal(
    resolveKitSelectionState({
      members: [asset({ id: "m1", status: "AVAILABLE" })],
      selectMode: "checkin",
      selectedAssetIds: new Set(),
      checkedInAssetIds: [],
    }),
    "unselectable"
  );
});

// ---------------------------------------------------------------------------
// Removal
// ---------------------------------------------------------------------------

function rowsFor(
  members: BookingAsset[],
  kit: BookingKit | null
): BookingRow[] {
  return [{ type: "kit", kitId: "kit-1", name: "Camera Kit", kit, members }];
}

test("a wholly selected kit the booking holds entirely travels as a kit", () => {
  const members = [
    inKit("m1", "kit-1", "Camera Kit"),
    inKit("m2", "kit-1", "Camera Kit"),
  ];
  assert.deepEqual(
    splitRemovalSelection({
      rows: rowsFor(members, cameraKit),
      selectedAssetIds: new Set(["m1", "m2"]),
    }),
    { assetIds: [], kitIds: ["kit-1"] }
  );
});

test("a kit the booking only partly holds travels as asset ids", () => {
  // The remove endpoint expands a kit to ALL its assets, so naming this kit
  // would drop the third member's rows, which nobody selected.
  const members = [
    inKit("m1", "kit-1", "Camera Kit"),
    inKit("m2", "kit-1", "Camera Kit"),
  ];
  assert.deepEqual(
    splitRemovalSelection({
      rows: rowsFor(members, { ...cameraKit, assetCount: 3 }),
      selectedAssetIds: new Set(["m1", "m2"]),
    }),
    { assetIds: ["m1", "m2"], kitIds: [] }
  );
});

test("a partly selected kit travels as asset ids", () => {
  const members = [
    inKit("m1", "kit-1", "Camera Kit"),
    inKit("m2", "kit-1", "Camera Kit"),
  ];
  assert.deepEqual(
    splitRemovalSelection({
      rows: rowsFor(members, cameraKit),
      selectedAssetIds: new Set(["m1"]),
    }),
    { assetIds: ["m1"], kitIds: [] }
  );
});

test("without kit records nothing travels as a kit", () => {
  const members = [
    inKit("m1", "kit-1", "Camera Kit"),
    inKit("m2", "kit-1", "Camera Kit"),
  ];
  assert.deepEqual(
    splitRemovalSelection({
      rows: rowsFor(members, null),
      selectedAssetIds: new Set(["m1", "m2"]),
    }),
    { assetIds: ["m1", "m2"], kitIds: [] }
  );
});

test("standalone assets picked alongside a kit keep their own ids", () => {
  const members = [
    inKit("m1", "kit-1", "Camera Kit"),
    inKit("m2", "kit-1", "Camera Kit"),
  ];
  const rows: BookingRow[] = [
    ...rowsFor(members, cameraKit),
    { type: "asset", item: asset({ id: "loose-1" }), inKit: false },
  ];
  const { assetIds, kitIds } = splitRemovalSelection({
    rows,
    selectedAssetIds: new Set(["m1", "m2", "loose-1"]),
  });
  assert.deepEqual(kitIds, ["kit-1"]);
  assert.deepEqual(assetIds, ["loose-1"]);
});

test("a removal names the kits before the assets", () => {
  assert.equal(
    describeRemoval({ assetCount: 2, kitCount: 1 }),
    "1 kit and 2 assets"
  );
  assert.equal(describeRemoval({ assetCount: 3, kitCount: 0 }), "3 assets");
  assert.equal(describeRemoval({ assetCount: 0, kitCount: 2 }), "2 kits");
});
