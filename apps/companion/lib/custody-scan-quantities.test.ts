/**
 * Tests for the Scan tab's per-row custody quantities: what each quantity row
 * may move, what it starts at, how a submit splits, and what the operator is
 * told afterwards.
 *
 * These run under Node's test runner via tsx, so this file and the module it
 * tests must not import React Native, Expo, or `@/`-aliased paths.
 *
 * Fixtures use the wire shapes: `custodyList` as the QR resolve sends it
 * (pinned producer-side by `mobile-auth.server.test.ts`) and
 * `quantityBreakdown` as the asset detail endpoint sends it.
 *
 * @see ./custody-scan-quantities.ts
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import type { AssetCustodyListEntry } from "./api/types";
import {
  buildQuantityFacts,
  bulkAssetRequest,
  chosenQuantity,
  custodyAssignCap,
  defaultQuantity,
  describeCustodyConfirm,
  planCustodySubmit,
  summarizeCustodySubmit,
  unitsFor,
  type CustodyListRow,
  type ScanQuantityFacts,
} from "./custody-scan-quantities";

/** One holder as the QR resolve's `custodyList` carries it. */
function holder(
  id: string,
  quantity: number,
  releasableQuantity: number = quantity
): AssetCustodyListEntry {
  return {
    custodian: { id, name: `Member ${id}`, userId: null },
    quantity,
    releasableQuantity,
  };
}

function facts(overrides: Partial<ScanQuantityFacts> = {}): ScanQuantityFacts {
  return {
    assignable: 10,
    holders: [],
    hasKitHeldUnits: false,
    unitOfMeasure: "pcs",
    consumable: false,
    ...overrides,
  };
}

function individualRow(qrId: string, title: string): CustodyListRow {
  return {
    qrId,
    type: "asset",
    targetId: `asset-${qrId}`,
    title,
    assetType: "INDIVIDUAL",
  };
}

function kitRow(qrId: string, title: string): CustodyListRow {
  return { qrId, type: "kit", targetId: `kit-${qrId}`, title };
}

function qtyRow(
  qrId: string,
  title: string,
  rowFacts: ScanQuantityFacts,
  chosen?: number
): CustodyListRow {
  return {
    qrId,
    type: "asset",
    targetId: `asset-${qrId}`,
    title,
    assetType: "QUANTITY_TRACKED",
    quantityFacts: rowFacts,
    chosenQuantity: chosen,
  };
}

// ── The assign cap ─────────────────────────────────────

test("the assign cap is the detail endpoint's custodyAvailable", () => {
  assert.equal(
    custodyAssignCap({
      quantity: 100,
      quantityBreakdown: {
        total: 100,
        available: 40,
        inCustody: 30,
        reserved: 30,
        checkedOut: 0,
        custodyAvailable: 70,
      },
    }),
    70
  );
});

test("the assign cap falls back to available, then to stock", () => {
  assert.equal(
    custodyAssignCap({
      quantity: 100,
      quantityBreakdown: {
        total: 100,
        available: 40,
        inCustody: 60,
        reserved: 0,
        checkedOut: 0,
      },
    }),
    40
  );
  // No breakdown: an idle asset, every unit is free.
  assert.equal(custodyAssignCap({ quantity: 25, quantityBreakdown: null }), 25);
});

test("the assign cap never goes below zero", () => {
  assert.equal(
    custodyAssignCap({
      quantity: 10,
      quantityBreakdown: {
        total: 10,
        available: -3,
        inCustody: 10,
        reserved: 3,
        checkedOut: 0,
      },
    }),
    0
  );
});

// ── Facts from a scan ──────────────────────────────────

test("assign facts take the cap from the asset detail", () => {
  const built = buildQuantityFacts({
    scanned: {
      quantity: 76,
      unitOfMeasure: "m",
      consumptionType: "TWO_WAY",
      custodyList: [holder("tm-1", 30)],
    },
    detail: {
      quantity: 76,
      quantityBreakdown: {
        total: 76,
        available: 46,
        inCustody: 30,
        reserved: 0,
        checkedOut: 0,
        custodyAvailable: 46,
      },
    },
  });
  assert.equal(built.assignable, 46);
  assert.equal(built.unitOfMeasure, "m");
  assert.equal(built.consumable, false);
});

test("without the asset detail, free units are stock minus units held", () => {
  const built = buildQuantityFacts({
    scanned: {
      quantity: 20,
      unitOfMeasure: null,
      custodyList: [holder("tm-1", 5), holder("tm-2", 3)],
    },
    detail: null,
  });
  assert.equal(built.assignable, 12);
});

test("release facts list operator holders with the units they can hand back", () => {
  const built = buildQuantityFacts({
    scanned: {
      quantity: 50,
      unitOfMeasure: "pcs",
      consumptionType: "ONE_WAY",
      // tm-1 holds 12, of which 4 came with a kit in custody.
      // tm-2 holds only kit units, so there is nothing for them to release.
      custodyList: [holder("tm-1", 12, 8), holder("tm-2", 6, 0)],
    },
    detail: null,
  });
  assert.deepEqual(built.holders, [{ teamMemberId: "tm-1", units: 8 }]);
  assert.equal(built.hasKitHeldUnits, true);
  assert.equal(built.consumable, true);
  assert.equal(unitsFor("release_custody", built), 8);
});

test("a holder without releasableQuantity counts all of their units", () => {
  const built = buildQuantityFacts({
    scanned: {
      quantity: 9,
      custodyList: [{ custodian: { id: "tm-1", name: "Ana" }, quantity: 4 }],
    },
    detail: null,
  });
  assert.deepEqual(built.holders, [{ teamMemberId: "tm-1", units: 4 }]);
  assert.equal(built.hasKitHeldUnits, false);
});

// ── Defaults and caps ─────────────────────────────────

test("assign starts at one unit and is capped by the free units", () => {
  const free = facts({ assignable: 46 });
  assert.equal(unitsFor("assign_custody", free), 46);
  assert.equal(defaultQuantity("assign_custody", free), 1);
  assert.equal(chosenQuantity("assign_custody", free, 80), 46);
  assert.equal(chosenQuantity("assign_custody", free, 12), 12);
});

test("release starts at every held unit and is capped by them", () => {
  const held = facts({
    holders: [{ teamMemberId: "tm-1", units: 30 }],
  });
  assert.equal(unitsFor("release_custody", held), 30);
  assert.equal(defaultQuantity("release_custody", held), 30);
  assert.equal(chosenQuantity("release_custody", held, 31), 30);
  assert.equal(chosenQuantity("release_custody", held, 5), 5);
});

test("a chosen quantity is a whole number of at least one", () => {
  const free = facts({ assignable: 10 });
  assert.equal(chosenQuantity("assign_custody", free, 0), 1);
  assert.equal(chosenQuantity("assign_custody", free, -4), 1);
  assert.equal(chosenQuantity("assign_custody", free, 2.7), 2);
  assert.equal(chosenQuantity("assign_custody", free, Number.NaN), 1);
});

test("a row with nothing to move defaults to zero", () => {
  assert.equal(defaultQuantity("assign_custody", facts({ assignable: 0 })), 0);
  assert.equal(defaultQuantity("release_custody", facts({ holders: [] })), 0);
});

// ── The submit split ──────────────────────────────────

test("a mixed scan splits into one asset request and one kit request", () => {
  const plan = planCustodySubmit("assign_custody", [
    individualRow("qr-1", "Tripod"),
    qtyRow("qr-2", "Cable", facts({ assignable: 46 }), 5),
    kitRow("qr-3", "Camera kit"),
    qtyRow("qr-4", "Tape", facts({ assignable: 3, unitOfMeasure: "rolls" })),
    individualRow("qr-5", "Light"),
  ]);

  assert.deepEqual(
    plan.kits.map((row) => row.targetId),
    ["kit-qr-3"]
  );
  // The asset request: every asset id, and units for the quantity rows only.
  assert.deepEqual(bulkAssetRequest(plan), {
    assetIds: ["asset-qr-1", "asset-qr-5", "asset-qr-2", "asset-qr-4"],
    quantities: {
      "asset-qr-2": 5,
      // Never edited: the row's default.
      "asset-qr-4": 1,
    },
  });
  assert.deepEqual(plan.refused, []);
});

test("an all-quantity scan sends every asset with its units", () => {
  const plan = planCustodySubmit("assign_custody", [
    qtyRow("qr-1", "Cable", facts({ assignable: 4 }), 4),
    qtyRow("qr-2", "Wire", facts({ assignable: 9 })),
  ]);
  assert.deepEqual(bulkAssetRequest(plan), {
    assetIds: ["asset-qr-1", "asset-qr-2"],
    quantities: { "asset-qr-1": 4, "asset-qr-2": 1 },
  });
  assert.equal(plan.kits.length, 0);
});

test("a scan without quantity rows sends no units", () => {
  const plan = planCustodySubmit("release_custody", [
    individualRow("qr-1", "Tripod"),
  ]);
  assert.deepEqual(bulkAssetRequest(plan), {
    assetIds: ["asset-qr-1"],
    quantities: {},
  });
});

test("release sends every held unit by default", () => {
  const plan = planCustodySubmit("release_custody", [
    qtyRow(
      "qr-1",
      "Cable",
      facts({ holders: [{ teamMemberId: "tm-7", units: 12 }] })
    ),
  ]);
  assert.deepEqual(bulkAssetRequest(plan).quantities, { "asset-qr-1": 12 });
});

test("a quantity row with no units is refused, not sent", () => {
  const plan = planCustodySubmit("release_custody", [
    qtyRow("qr-1", "Cable", facts({ holders: [] })),
  ]);
  assert.equal(plan.quantityRows.length, 0);
  assert.deepEqual(plan.refused, [
    { qrId: "qr-1", title: "Cable", error: "No units to move for this asset." },
  ]);
});

// ── What the operator is told ─────────────────────────

test("the success message counts assets and units separately", () => {
  const plan = planCustodySubmit("assign_custody", [
    individualRow("qr-1", "Tripod"),
    individualRow("qr-2", "Light"),
    kitRow("qr-3", "Camera kit"),
    qtyRow("qr-4", "Cable", facts({ unitOfMeasure: "m" }), 10),
    qtyRow("qr-5", "Wire", facts({ unitOfMeasure: "m" }), 5),
  ]);

  const summary = summarizeCustodySubmit(
    "assign_custody",
    plan,
    {
      assetError: null,
      kitError: null,
      movedQuantityAssetIds: ["asset-qr-4", "asset-qr-5"],
    },
    { custodianName: "Jane", isSelfService: false }
  );

  assert.equal(summary.title, "Done");
  assert.equal(
    summary.message,
    "Assigned 2 assets, 1 kit and 15 m across 2 quantity-tracked assets to Jane."
  );
  assert.deepEqual(summary.succeededQrIds.sort(), [
    "qr-1",
    "qr-2",
    "qr-3",
    "qr-4",
    "qr-5",
  ]);
  assert.deepEqual(summary.rowErrors, {});
});

test("mixed units are counted as units", () => {
  const plan = planCustodySubmit("release_custody", [
    qtyRow(
      "qr-1",
      "Cable",
      facts({
        unitOfMeasure: "m",
        holders: [{ teamMemberId: "tm-1", units: 10 }],
      }),
      10
    ),
    qtyRow(
      "qr-2",
      "Plugs",
      facts({
        unitOfMeasure: "pcs",
        holders: [{ teamMemberId: "tm-1", units: 4 }],
      }),
      4
    ),
  ]);
  const summary = summarizeCustodySubmit(
    "release_custody",
    plan,
    {
      assetError: null,
      kitError: null,
      movedQuantityAssetIds: ["asset-qr-1", "asset-qr-2"],
    },
    { isSelfService: false }
  );
  assert.equal(
    summary.message,
    "Released custody of 14 units across 2 quantity-tracked assets."
  );
});

test("one quantity row is named with its units", () => {
  const plan = planCustodySubmit("assign_custody", [
    qtyRow("qr-1", "Cable", facts(), 5),
  ]);
  const summary = summarizeCustodySubmit(
    "assign_custody",
    plan,
    {
      assetError: null,
      kitError: null,
      movedQuantityAssetIds: ["asset-qr-1"],
    },
    { isSelfService: true }
  );
  assert.equal(summary.message, 'You have custody of 5 pcs of "Cable".');
});

test("a refused asset request keeps every asset row, whole or by units, with the server's reason", () => {
  const plan = planCustodySubmit("assign_custody", [
    individualRow("qr-1", "Tripod"),
    qtyRow("qr-2", "Cable", facts({ assignable: 46 }), 6),
  ]);
  const reason = 'Nothing was assigned. "Cable" (asked for 6, 5 free).';
  const summary = summarizeCustodySubmit(
    "assign_custody",
    plan,
    { assetError: reason, kitError: null },
    { custodianName: "Jane", isSelfService: false }
  );

  assert.equal(summary.title, "Not done");
  assert.equal(
    summary.message,
    `Still in your list:\n• 1 asset and 6 pcs of "Cable": ${reason}`
  );
  assert.deepEqual(summary.succeededQrIds, []);
  assert.deepEqual(summary.rowErrors, { "qr-1": reason, "qr-2": reason });
});

test("a quantity row the server refused after its checks stays with the reason, and the rest are done", () => {
  const plan = planCustodySubmit("assign_custody", [
    individualRow("qr-1", "Tripod"),
    qtyRow("qr-2", "Cable", facts(), 2),
    qtyRow("qr-3", "Wire", facts(), 1),
  ]);
  const reason = "Cannot check out 2 units. Only 1 units are available.";
  const summary = summarizeCustodySubmit(
    "assign_custody",
    plan,
    {
      assetError: null,
      kitError: null,
      movedQuantityAssetIds: ["asset-qr-3"],
      refusedQuantities: [{ assetId: "asset-qr-2", message: reason }],
    },
    { custodianName: "Jane", isSelfService: false }
  );

  assert.equal(summary.title, "Partly done");
  assert.equal(
    summary.message,
    'Assigned 1 asset and 1 pcs of "Wire" to Jane.\n\n' +
      "Still in your list:\n" +
      `• 2 pcs of "Cable": ${reason}`
  );
  assert.deepEqual(summary.succeededQrIds.sort(), ["qr-1", "qr-3"]);
  assert.deepEqual(summary.rowErrors, { "qr-2": reason });
});

test("kits and assets are reported apart, since they are two requests", () => {
  const plan = planCustodySubmit("release_custody", [
    individualRow("qr-1", "Tripod"),
    kitRow("qr-2", "Camera kit"),
  ]);
  const summary = summarizeCustodySubmit(
    "release_custody",
    plan,
    { assetError: null, kitError: "Kit is not in custody." },
    { isSelfService: false }
  );
  assert.equal(summary.title, "Partly done");
  assert.equal(
    summary.message,
    'Released custody of "Tripod".\n\n' +
      "Still in your list:\n" +
      '• "Camera kit": Kit is not in custody.'
  );
  assert.deepEqual(summary.succeededQrIds, ["qr-1"]);
  assert.deepEqual(summary.rowErrors, { "qr-2": "Kit is not in custody." });
});

test("a quantity row whose scan had no type does not hide the rows that moved", () => {
  // The untyped row went as a whole asset and the server skipped it; the
  // typed row's units moved. Only the server's moved ids decide that.
  const plan = planCustodySubmit("assign_custody", [
    { ...individualRow("qr-1", "Old scan"), assetType: undefined },
    qtyRow("qr-2", "Cable", facts(), 2),
  ]);
  const summary = summarizeCustodySubmit(
    "assign_custody",
    plan,
    {
      assetError: null,
      kitError: null,
      skippedQuantityTracked: 1,
      movedQuantityAssetIds: ["asset-qr-2"],
    },
    { custodianName: "Jane", isSelfService: false }
  );
  assert.deepEqual(summary.rowErrors, {});
  assert.ok(summary.succeededQrIds.includes("qr-2"));
  assert.ok(summary.message.includes("1 quantity-tracked asset skipped."));
});

test("a server that ignores quantities keeps the quantity rows and says why", () => {
  const plan = planCustodySubmit("assign_custody", [
    individualRow("qr-1", "Tripod"),
    qtyRow("qr-2", "Cable", facts(), 2),
  ]);
  const summary = summarizeCustodySubmit(
    "assign_custody",
    plan,
    { assetError: null, kitError: null, skippedQuantityTracked: 1 },
    { custodianName: "Jane", isSelfService: false }
  );
  assert.equal(summary.title, "Partly done");
  assert.deepEqual(summary.succeededQrIds, ["qr-1"]);
  assert.ok(
    summary.rowErrors["qr-2"]?.startsWith(
      "This server does not take unit counts"
    )
  );
});

test("a refused quantity row is reported like a failed one", () => {
  const plan = planCustodySubmit("release_custody", [
    qtyRow("qr-1", "Cable", facts({ holders: [] })),
  ]);
  const summary = summarizeCustodySubmit(
    "release_custody",
    plan,
    { assetError: null, kitError: null },
    { isSelfService: false }
  );
  assert.equal(summary.title, "Not done");
  assert.equal(summary.rowErrors["qr-1"], "No units to move for this asset.");
});

test("the release confirm names the units and warns when they are used up", () => {
  const plan = planCustodySubmit("release_custody", [
    individualRow("qr-1", "Tripod"),
    qtyRow(
      "qr-2",
      "Cable ties",
      facts({
        consumable: true,
        holders: [{ teamMemberId: "tm-1", units: 30 }],
      })
    ),
  ]);
  const confirm = describeCustodyConfirm("release_custody", plan, {
    isSelfService: false,
  });
  assert.equal(confirm.title, "Release Custody");
  assert.equal(confirm.confirmLabel, "Release");
  assert.equal(
    confirm.message,
    'Release custody of 1 asset and 30 pcs of "Cable ties"?\n\n' +
      "One-way units are recorded as used up. That permanently reduces total stock."
  );
});

test("the assign confirm names the custodian", () => {
  const plan = planCustodySubmit("assign_custody", [
    qtyRow("qr-1", "Cable", facts({ unitOfMeasure: "m", assignable: 46 }), 25),
  ]);
  const confirm = describeCustodyConfirm("assign_custody", plan, {
    custodianName: "Jane",
    isSelfService: false,
  });
  assert.equal(confirm.title, "Assign Custody");
  assert.equal(confirm.message, 'Assign 25 m of "Cable" to Jane?');
  assert.equal(confirm.confirmLabel, "Assign");
});
