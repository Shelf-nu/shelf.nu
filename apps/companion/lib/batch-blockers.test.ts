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
  blockerKeysFor,
  computeBlockers,
  type BlockableItem,
  type BookingBlockerContext,
} from "./batch-blockers";
import type { ScanQuantityFacts } from "./custody-scan-quantities";

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

// ── Custody modes ─────────────────────────────────────
//
// Every blocker the two custody modes can raise is pinned here, by id. A
// missing blocker is invisible: the row goes to the server, is skipped or
// refused there, and nothing on screen said it would be. Adding a blocker
// without a case below fails the manifest assertions.

/** Ids in display order, pinned so a new blocker needs a new case. */
const EXPECTED_ASSIGN_IDS = [
  "qty-nothing-free",
  "asset-in-custody",
  "asset-checked-out",
  "asset-part-of-kit",
  "kit-in-custody",
  "kit-checked-out",
  "kit-has-assets-in-custody",
];

const EXPECTED_RELEASE_IDS = [
  "qty-held-via-kit",
  "qty-nothing-held",
  "qty-several-holders",
  "asset-not-in-custody",
  "asset-part-of-kit",
  "kit-not-in-custody",
];

function asset(overrides: Partial<BlockableItem> = {}): BlockableItem {
  return {
    qrId: "qr-a",
    type: "asset",
    targetId: "asset-a",
    title: "Tripod",
    status: "AVAILABLE",
    kitId: null,
    assetType: "INDIVIDUAL",
    ...overrides,
  };
}

function kit(overrides: Partial<BlockableItem> = {}): BlockableItem {
  return {
    qrId: "qr-k",
    type: "kit",
    targetId: "kit-k",
    title: "Camera kit",
    status: "AVAILABLE",
    kitId: null,
    hasAssetsInCustody: false,
    ...overrides,
  };
}

function quantityFacts(
  overrides: Partial<ScanQuantityFacts> = {}
): ScanQuantityFacts {
  return {
    assignable: 10,
    holders: [{ teamMemberId: "tm-1", name: "Ana", units: 4 }],
    hasKitHeldUnits: false,
    unitOfMeasure: "pcs",
    consumable: false,
    ...overrides,
  };
}

/** A quantity row with free units AND units held by one person. */
function quantityRow(overrides: Partial<BlockableItem> = {}): BlockableItem {
  return asset({
    qrId: "qr-q",
    targetId: "asset-q",
    title: "Cable",
    assetType: "QUANTITY_TRACKED",
    quantityFacts: quantityFacts(),
    ...overrides,
  });
}

function idsFor(
  action: "assign_custody" | "release_custody",
  items: BlockableItem[]
) {
  return computeBlockers(action, items).map((g): string => g.key);
}

test("assign custody can raise exactly the pinned blockers", () => {
  assert.deepEqual(blockerKeysFor("assign_custody"), EXPECTED_ASSIGN_IDS);
});

test("release custody can raise exactly the pinned blockers", () => {
  assert.deepEqual(blockerKeysFor("release_custody"), EXPECTED_RELEASE_IDS);
});

test("healthy rows raise no custody blocker", () => {
  assert.deepEqual(
    idsFor("assign_custody", [asset(), kit(), quantityRow()]),
    []
  );
  assert.deepEqual(
    idsFor("release_custody", [
      asset({ status: "IN_CUSTODY" }),
      kit({ status: "IN_CUSTODY" }),
      quantityRow(),
    ]),
    []
  );
});

/** One row in the state that raises each assign id. */
const ASSIGN_CASES: Record<string, BlockableItem> = {
  "qty-nothing-free": quantityRow({
    quantityFacts: quantityFacts({ assignable: 0 }),
  }),
  "asset-in-custody": asset({ status: "IN_CUSTODY" }),
  "asset-checked-out": asset({ status: "CHECKED_OUT" }),
  "asset-part-of-kit": asset({ kitId: "kit-9" }),
  "kit-in-custody": kit({ status: "IN_CUSTODY" }),
  "kit-checked-out": kit({ status: "CHECKED_OUT" }),
  "kit-has-assets-in-custody": kit({ hasAssetsInCustody: true }),
};

/** One row in the state that raises each release id. */
const RELEASE_CASES: Record<string, BlockableItem> = {
  "qty-held-via-kit": quantityRow({
    quantityFacts: quantityFacts({ holders: [], hasKitHeldUnits: true }),
  }),
  "qty-nothing-held": quantityRow({
    quantityFacts: quantityFacts({ holders: [] }),
  }),
  "qty-several-holders": quantityRow({
    quantityFacts: quantityFacts({
      holders: [
        { teamMemberId: "tm-1", name: "Ana", units: 2 },
        { teamMemberId: "tm-2", name: "Bo", units: 3 },
      ],
    }),
  }),
  "asset-not-in-custody": asset({ status: "AVAILABLE" }),
  "asset-part-of-kit": asset({ status: "IN_CUSTODY", kitId: "kit-9" }),
  "kit-not-in-custody": kit({ status: "AVAILABLE" }),
};

test("every assign blocker has a case", () => {
  assert.deepEqual(Object.keys(ASSIGN_CASES), EXPECTED_ASSIGN_IDS);
});

test("every release blocker has a case", () => {
  assert.deepEqual(Object.keys(RELEASE_CASES), EXPECTED_RELEASE_IDS);
});

for (const [id, row] of Object.entries(ASSIGN_CASES)) {
  test(`assign custody raises ${id} for a row in that state`, () => {
    assert.ok(idsFor("assign_custody", [row]).includes(id));
  });
}

for (const [id, row] of Object.entries(RELEASE_CASES)) {
  test(`release custody raises ${id} for a row in that state`, () => {
    assert.ok(idsFor("release_custody", [row]).includes(id));
  });
}

test("a quantity row with free units is not refused for its whole-row status", () => {
  // `status` and kit membership are whole-row facts: a pool reads IN_CUSTODY
  // or CHECKED_OUT while one unit is out, and sits in a kit while most of it
  // is free. Only the units this mode can move decide.
  for (const status of ["IN_CUSTODY", "CHECKED_OUT"]) {
    assert.deepEqual(
      idsFor("assign_custody", [quantityRow({ status, kitId: "kit-9" })]),
      []
    );
  }
});

test("a quantity row with held units is not refused for its whole-row status", () => {
  assert.deepEqual(
    idsFor("release_custody", [
      quantityRow({ status: "AVAILABLE", kitId: "kit-9" }),
    ]),
    []
  );
});

test("a quantity row without known units is blocked, never sent", () => {
  const unknown = quantityRow({ quantityFacts: undefined });
  assert.deepEqual(idsFor("assign_custody", [unknown]), ["qty-nothing-free"]);
  assert.deepEqual(idsFor("release_custody", [unknown]), ["qty-nothing-held"]);
});

test("a row from a server that sends no asset type keeps the whole-row rules", () => {
  assert.deepEqual(
    idsFor("assign_custody", [
      asset({ assetType: undefined, status: "IN_CUSTODY" }),
    ]),
    ["asset-in-custody"]
  );
});

test("each blocker removes only the rows it names", () => {
  const free = quantityRow({ qrId: "qr-free" });
  const empty = quantityRow({
    qrId: "qr-empty",
    targetId: "asset-empty",
    quantityFacts: quantityFacts({ assignable: 0 }),
  });
  const groups = computeBlockers("assign_custody", [free, empty]);
  assert.deepEqual(
    groups.map((g) => [g.key, g.qrIds]),
    [["qty-nothing-free", ["qr-empty"]]]
  );
  assert.equal(
    groups[0].message,
    "1 asset has no units available. Every unit is in custody, in a kit, or out on a booking."
  );
});
