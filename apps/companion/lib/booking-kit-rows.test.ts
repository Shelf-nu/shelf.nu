/**
 * Tests for the booking detail's kit grouping rules.
 *
 * These run under Node's test runner via tsx, so this file and the module it
 * tests must not import React Native, Expo, or `@/`-aliased paths.
 *
 * The rules under test are the ones a screenshot cannot check: which kit a
 * quantity-tracked asset is grouped under when its slices disagree, what a
 * kit's badge says on a booking that is over, how a selection counts a kit as
 * one thing, and when a removal may name the kit instead of listing its
 * assets.
 *
 * @see ./booking-kit-rows.ts
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  bookingRowKey,
  buildBookingRows,
  countSelection,
  describeBookingRows,
  describeRemoval,
  describeSelection,
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

test("interleaved kits keep their members in the order the server sent", () => {
  const rows = buildBookingRows({
    assets: [
      inKit("a1", "kit-1", "Camera Kit"),
      inKit("b1", "kit-2", "Rig"),
      inKit("a2", "kit-1", "Camera Kit"),
    ],
    kits: undefined,
    expandedKitIds: new Set(["kit-1", "kit-2"]),
  });

  assert.deepEqual(rows.map(bookingRowKey), [
    "kit:kit-1",
    "asset:a1",
    "asset:a2",
    "kit-end:kit-1",
    "kit:kit-2",
    "asset:b1",
    "kit-end:kit-2",
  ]);
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

test("a marker elsewhere on the booking leaves this kit's reading alone", () => {
  // Markers are per slice and the all-at-once check-out writes none, so a kit
  // no member of which carries one still reads as having gone out — however
  // many the rest of the booking has picked up since.
  assert.deepEqual(
    resolveBookingKitBadge({
      kit: cameraKit,
      members: [
        inKit("m1", "kit-1", "Camera Kit"),
        inKit("m2", "kit-1", "Camera Kit"),
      ],
      bookingStatus: "COMPLETE",
      checkedInAssetIds: [],
      checkedOutAssetIds: ["added-later"],
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
    { assetIds: [], kitIds: ["kit-1"], standaloneAssetIds: [] }
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
    { assetIds: ["m1", "m2"], kitIds: [], standaloneAssetIds: [] }
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
    { assetIds: ["m1"], kitIds: [], standaloneAssetIds: [] }
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
    { assetIds: ["m1", "m2"], kitIds: [], standaloneAssetIds: [] }
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
  const { assetIds, kitIds, standaloneAssetIds } = splitRemovalSelection({
    rows,
    selectedAssetIds: new Set(["m1", "m2", "loose-1"]),
  });
  assert.deepEqual(kitIds, ["kit-1"]);
  assert.deepEqual(assetIds, ["loose-1"]);
  assert.deepEqual(standaloneAssetIds, ["loose-1"]);
});

test("a member of an unnamed kit stops any kit being named", () => {
  // Naming a kit makes the endpoint read the bare ids beside it as
  // "delete the row with no kit". A member of a kit that is NOT named has no
  // such row, so it would be reported removed and quietly stay. The whole
  // selection travels as bare ids instead, which removes every slice.
  const audio = [
    inKit("a1", "kit-1", "Camera Kit"),
    inKit("a2", "kit-1", "Camera Kit"),
  ];
  const rig = [
    inKit("b1", "kit-2", "Rig"),
    inKit("b2", "kit-2", "Rig"),
    inKit("b3", "kit-2", "Rig"),
  ];
  const rows: BookingRow[] = [
    {
      type: "kit",
      kitId: "kit-1",
      name: "Camera Kit",
      kit: cameraKit,
      members: audio,
    },
    {
      type: "kit",
      kitId: "kit-2",
      name: "Rig",
      kit: { ...cameraKit, id: "kit-2", name: "Rig", assetCount: 3 },
      members: rig,
    },
  ];

  // Whole of kit-1 picked, plus ONE member of kit-2.
  const { assetIds, kitIds, standaloneAssetIds } = splitRemovalSelection({
    rows,
    selectedAssetIds: new Set(["a1", "a2", "b1"]),
  });

  assert.deepEqual(kitIds, []);
  assert.deepEqual(assetIds.sort(), ["a1", "a2", "b1"]);
  // The plain-ids path gives the distinction up: every slice of each is meant
  // to go, so nothing is scoped to a kit-less row.
  assert.deepEqual(standaloneAssetIds, []);
});

test("an asset shown standalone says so whatever else is picked", () => {
  // A quantity-tracked asset whose slices disagree gets a row of its own while
  // still holding kit-driven rows. Kit membership cannot see that, so the
  // explicit list is what tells the server the user ticked the loose row —
  // and it says the same thing whether or not an unrelated kit travels beside
  // it.
  const members = [
    inKit("m1", "kit-1", "Camera Kit"),
    inKit("m2", "kit-1", "Camera Kit"),
  ];
  const mixedSlices = asset({
    id: "qt-1",
    type: "QUANTITY_TRACKED",
    kitId: null,
    kit: null,
    slices: [
      { bookingAssetId: "ba1", quantity: 2, assetKitId: null, kit: null },
      {
        bookingAssetId: "ba2",
        quantity: 3,
        assetKitId: "ak-other",
        kit: { id: "kit-9", name: "Lighting" },
      },
    ],
  });
  const rows: BookingRow[] = [
    ...rowsFor(members, cameraKit),
    { type: "asset", item: mixedSlices, inKit: false },
  ];

  assert.deepEqual(
    splitRemovalSelection({
      rows,
      selectedAssetIds: new Set(["m1", "m2", "qt-1"]),
    }),
    { assetIds: ["qt-1"], kitIds: ["kit-1"], standaloneAssetIds: ["qt-1"] }
  );

  assert.deepEqual(
    splitRemovalSelection({ rows, selectedAssetIds: new Set(["qt-1"]) }),
    { assetIds: ["qt-1"], kitIds: [], standaloneAssetIds: ["qt-1"] }
  );
});

test("expanding a kit does not change what the removal posts", () => {
  // An expanded kit emits its members as asset rows as well. Those rows carry
  // `inKit`, so they are never counted as rows the asset holds in its own
  // right — a removal must read the same whether the kit is open or shut.
  const members = [
    inKit("m1", "kit-1", "Camera Kit"),
    inKit("m2", "kit-1", "Camera Kit"),
  ];
  const looseRow = {
    type: "asset" as const,
    item: asset({ id: "loose-1" }),
    inKit: false,
  };
  const collapsed: BookingRow[] = [...rowsFor(members, cameraKit), looseRow];
  const expanded: BookingRow[] = [
    ...rowsFor(members, cameraKit),
    { type: "asset", item: members[0], inKit: true },
    { type: "asset", item: members[1], inKit: true },
    { type: "kit-end", kitId: "kit-1" },
    looseRow,
  ];
  const selectedAssetIds = new Set(["m1", "m2", "loose-1"]);

  assert.deepEqual(
    splitRemovalSelection({ rows: expanded, selectedAssetIds }),
    splitRemovalSelection({ rows: collapsed, selectedAssetIds })
  );
  assert.deepEqual(
    splitRemovalSelection({ rows: expanded, selectedAssetIds }),
    {
      assetIds: ["loose-1"],
      kitIds: ["kit-1"],
      standaloneAssetIds: ["loose-1"],
    }
  );
});

test("a standalone asset beside a whole kit still lets the kit be named", () => {
  // The guard above must not fire for a genuinely loose asset — it has the
  // row the endpoint looks for.
  const members = [
    inKit("m1", "kit-1", "Camera Kit"),
    inKit("m2", "kit-1", "Camera Kit"),
  ];
  const rows: BookingRow[] = [
    ...rowsFor(members, cameraKit),
    { type: "asset", item: asset({ id: "loose-1" }), inKit: false },
  ];

  const { assetIds, kitIds, standaloneAssetIds } = splitRemovalSelection({
    rows,
    selectedAssetIds: new Set(["m1", "m2", "loose-1"]),
  });

  assert.deepEqual(kitIds, ["kit-1"]);
  assert.deepEqual(assetIds, ["loose-1"]);
  assert.deepEqual(standaloneAssetIds, ["loose-1"]);
});

// ---------------------------------------------------------------------------
// Selectability, remaining branches
// ---------------------------------------------------------------------------

test("nothing is selectable outside a selection mode", () => {
  assert.equal(isBookingAssetSelectable(asset({ id: "a1" }), null, []), false);
});

test("check-in offers a quantity-tracked asset with units still to reconcile", () => {
  assert.equal(
    isBookingAssetSelectable(
      asset({ id: "a1", type: "QUANTITY_TRACKED", remainingToCheckIn: 4 }),
      "checkin",
      []
    ),
    true
  );
});

test("check-in skips a quantity-tracked asset with nothing left to reconcile", () => {
  assert.equal(
    isBookingAssetSelectable(
      asset({ id: "a1", type: "QUANTITY_TRACKED", remainingToCheckIn: 0 }),
      "checkin",
      []
    ),
    false
  );
});

test("a header with nothing picked reads as none", () => {
  assert.equal(
    resolveKitSelectionState({
      members: [asset({ id: "m1" }), asset({ id: "m2" })],
      selectMode: "remove",
      selectedAssetIds: new Set(),
      checkedInAssetIds: [],
    }),
    "none"
  );
});

test("a removal names the kits before the assets", () => {
  assert.equal(
    describeRemoval({ assetCount: 2, kitCount: 1 }),
    "1 kit and 2 assets"
  );
  assert.equal(
    describeRemoval({ assetCount: 1, kitCount: 1 }),
    "1 kit and 1 asset"
  );
  assert.equal(describeRemoval({ assetCount: 3, kitCount: 0 }), "3 assets");
  assert.equal(describeRemoval({ assetCount: 0, kitCount: 2 }), "2 kits");
});

test("a removal with nothing to name still names assets", () => {
  assert.equal(describeRemoval({ assetCount: 0, kitCount: 0 }), "0 assets");
});

// ---------------------------------------------------------------------------
// The floating action's label
// ---------------------------------------------------------------------------

test("a selection names kits before assets, joined by an ampersand", () => {
  assert.equal(
    describeSelection({ kitCount: 1, assetCount: 1 }),
    "1 Kit & 1 Asset"
  );
  assert.equal(
    describeSelection({ kitCount: 1, assetCount: 2 }),
    "1 Kit & 2 Assets"
  );
  assert.equal(
    describeSelection({ kitCount: 2, assetCount: 1 }),
    "2 Kits & 1 Asset"
  );
  assert.equal(
    describeSelection({ kitCount: 3, assetCount: 4 }),
    "3 Kits & 4 Assets"
  );
});

test("a selection of only kits does not mention assets", () => {
  assert.equal(describeSelection({ kitCount: 1, assetCount: 0 }), "1 Kit");
  assert.equal(describeSelection({ kitCount: 2, assetCount: 0 }), "2 Kits");
});

test("a selection of only assets does not mention kits", () => {
  assert.equal(describeSelection({ kitCount: 0, assetCount: 1 }), "1 Asset");
  assert.equal(describeSelection({ kitCount: 0, assetCount: 3 }), "3 Assets");
});

test("an empty selection still reads as a count", () => {
  assert.equal(describeSelection({ kitCount: 0, assetCount: 0 }), "0 Assets");
});

/** Two kits and a standalone asset, as the list renders them. */
function kitsAndLooseAsset(expandedKitIds: ReadonlySet<string>): BookingRow[] {
  return buildBookingRows({
    assets: [
      inKit("m1", "kit-1", "Camera Kit"),
      inKit("m2", "kit-1", "Camera Kit"),
      inKit("m3", "kit-1", "Camera Kit"),
      inKit("r1", "kit-2", "Rig"),
      inKit("r2", "kit-2", "Rig"),
      asset({ id: "loose-1" }),
      asset({ id: "loose-2" }),
    ],
    kits: [
      { ...cameraKit, assetCount: 3 },
      { ...cameraKit, id: "kit-2", name: "Rig", assetCount: 2 },
    ],
    expandedKitIds,
  });
}

test("a picked kit counts once, however many members it holds", () => {
  assert.deepEqual(
    countSelection({
      rows: kitsAndLooseAsset(new Set()),
      selectedAssetIds: new Set(["m1", "m2", "m3"]),
      selectMode: "checkout",
      checkedInAssetIds: [],
    }),
    { kitCount: 1, assetCount: 0 }
  );
});

test("a standalone asset beside a picked kit counts as one asset", () => {
  assert.deepEqual(
    countSelection({
      rows: kitsAndLooseAsset(new Set()),
      selectedAssetIds: new Set(["m1", "m2", "m3", "loose-1"]),
      selectMode: "checkout",
      checkedInAssetIds: [],
    }),
    { kitCount: 1, assetCount: 1 }
  );
});

test("every picked kit and every standalone asset is counted", () => {
  assert.deepEqual(
    countSelection({
      rows: kitsAndLooseAsset(new Set()),
      selectedAssetIds: new Set([
        "m1",
        "m2",
        "m3",
        "r1",
        "r2",
        "loose-1",
        "loose-2",
      ]),
      selectMode: "remove",
      checkedInAssetIds: [],
    }),
    { kitCount: 2, assetCount: 2 }
  );
});

test("opening a kit does not change what the selection counts", () => {
  const selectedAssetIds = new Set(["r1", "r2", "loose-2"]);
  const collapsed = countSelection({
    rows: kitsAndLooseAsset(new Set()),
    selectedAssetIds,
    selectMode: "checkout",
    checkedInAssetIds: [],
  });
  const expanded = countSelection({
    rows: kitsAndLooseAsset(new Set(["kit-1", "kit-2"])),
    selectedAssetIds,
    selectMode: "checkout",
    checkedInAssetIds: [],
  });
  assert.deepEqual(collapsed, { kitCount: 1, assetCount: 1 });
  assert.deepEqual(expanded, collapsed);
});

test("in check-in a kit counts once its outstanding members are picked", () => {
  // m1 is out; m2 never left, so check-in cannot act on it. Picking m1 alone
  // is the whole of what the header offers.
  const rows = buildBookingRows({
    assets: [
      asset({
        id: "m1",
        kitId: "kit-1",
        kit: { id: "kit-1", name: "Camera Kit" },
        status: "CHECKED_OUT",
      }),
      asset({
        id: "m2",
        kitId: "kit-1",
        kit: { id: "kit-1", name: "Camera Kit" },
        status: "AVAILABLE",
      }),
    ],
    kits: [cameraKit],
    expandedKitIds: new Set(),
  });
  assert.deepEqual(
    countSelection({
      rows,
      selectedAssetIds: new Set(["m1"]),
      selectMode: "checkin",
      checkedInAssetIds: [],
    }),
    { kitCount: 1, assetCount: 0 }
  );
});

test("members of a partly picked kit count as the assets they are", () => {
  // The header reads "some", so the kit is not picked whole; the label still
  // covers the member the submit will send.
  assert.deepEqual(
    countSelection({
      rows: kitsAndLooseAsset(new Set()),
      selectedAssetIds: new Set(["m1"]),
      selectMode: "remove",
      checkedInAssetIds: [],
    }),
    { kitCount: 0, assetCount: 1 }
  );
});

test("nothing picked counts nothing", () => {
  assert.deepEqual(
    countSelection({
      rows: kitsAndLooseAsset(new Set()),
      selectedAssetIds: new Set(),
      selectMode: "checkout",
      checkedInAssetIds: [],
    }),
    { kitCount: 0, assetCount: 0 }
  );
});
