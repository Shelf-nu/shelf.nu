/**
 * Tests for the legacy group conversion planner.
 *
 * Pure: no mocks. Pins step 1 (candidate shares) to the greedy fill it
 * reproduces, the gate, the OVERFLOW re-marking of settlements beyond
 * departures, and the rows seeded for standalone and kit slices.
 *
 * @see {@link file://./conversion.ts}
 */
import { sourceRowViolations } from "@shelf/quantity-control";
import { describe, expect, it } from "vitest";

import { attributeDispositionsByBookingAsset } from "../checkout-attribution";
import { computeCandidateShares, planGroupConversion } from "./conversion";
import type { ConversionLog, ConversionSlice, PlannedShare } from "./types";

/** A standalone slice with no recorded source unless overridden. */
function slice(
  id: string,
  quantity: number,
  checkedOutQuantity: number,
  overrides: Partial<ConversionSlice> = {}
): ConversionSlice {
  return {
    id,
    quantity,
    checkedOutQuantity,
    assetKitId: null,
    sourceLocationId: null,
    recordedSourceIsUnplaced: false,
    ...overrides,
  };
}

/** A disposition log written `minute` minutes into the day. */
function log(
  id: string,
  quantity: number,
  minute: number,
  bookingAssetId: string | null = null
): ConversionLog {
  return {
    id,
    quantity,
    bookingAssetId,
    createdAt: new Date(Date.UTC(2026, 0, 1, 0, minute)),
  };
}

/** Sum of candidate share quantities per slice id. */
function totalsBySlice(shares: PlannedShare[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const s of shares) {
    if (s.bookingAssetId === null) continue;
    out.set(s.bookingAssetId, (out.get(s.bookingAssetId) ?? 0) + s.quantity);
  }
  return out;
}

/** The greedy fill's per-slice totals, with capacity `max(Q, D)`. */
function greedyTotals(slices: ConversionSlice[], logs: ConversionLog[]) {
  return attributeDispositionsByBookingAsset({
    bookingAssetRows: slices.map((s) => ({
      id: s.id,
      assetKitId: s.assetKitId,
      quantity: Math.max(s.quantity, s.checkedOutQuantity),
    })),
    consumptionLogs: logs.map((l) => ({
      bookingAssetId: l.bookingAssetId,
      quantity: l.quantity,
    })),
  });
}

/** Seeded PRNG (mulberry32) so the property test is reproducible. */
function prng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A random group: 1 to 4 slices, 0 to 12 logs, mixed tags, tied dates. */
function generateGroup(rand: () => number) {
  const int = (min: number, max: number) =>
    min + Math.floor(rand() * (max - min + 1));
  const sliceCount = int(1, 4);
  const slices: ConversionSlice[] = [];
  for (let i = 0; i < sliceCount; i++) {
    // Random id prefixes so the greedy order is not the creation order.
    slices.push(
      slice(
        `${String.fromCharCode(97 + int(0, 25))}${i}`,
        int(0, 8),
        int(0, 10),
        {
          assetKitId: rand() < 0.35 ? `kit-${i}` : null,
          sourceLocationId: rand() < 0.3 ? `loc-${i}` : null,
          recordedSourceIsUnplaced: rand() < 0.2,
        }
      )
    );
  }
  const logs: ConversionLog[] = [];
  const logCount = int(0, 12);
  for (let i = 0; i < logCount; i++) {
    const roll = rand();
    const tag =
      roll < 0.4
        ? slices[int(0, sliceCount - 1)].id
        : roll < 0.45
        ? "outside-group"
        : null;
    logs.push(log(`l${int(0, 99)}-${i}`, int(0, 9), int(0, 5), tag));
  }
  return { slices, logs, poolHasPlacements: rand() < 0.5 };
}

describe("computeCandidateShares", () => {
  it("two-pass: tagged logs first", () => {
    const slices = [slice("s1", 5, 5), slice("s2", 5, 5)];
    const logs = [log("untagged", 5, 1), log("tagged", 5, 2, "s1")];

    const shares = computeCandidateShares({ slices, logs });

    expect(shares).toEqual([
      {
        consumptionLogId: "tagged",
        bookingAssetId: "s1",
        sourceKey: null,
        quantity: 5,
        origin: "SEEDED",
      },
      {
        consumptionLogId: "untagged",
        bookingAssetId: "s2",
        sourceKey: null,
        quantity: 5,
        origin: "SEEDED",
      },
    ]);
    expect(totalsBySlice(shares)).toEqual(greedyTotals(slices, logs));
  });

  it("two-pass: an early untagged log overflows when the tagged one fills the only slice", () => {
    const slices = [slice("s1", 5, 5)];
    const logs = [log("untagged", 5, 1), log("tagged", 5, 2, "s1")];

    const shares = computeCandidateShares({ slices, logs });

    expect(shares).toEqual([
      {
        consumptionLogId: "tagged",
        bookingAssetId: "s1",
        sourceKey: null,
        quantity: 5,
        origin: "SEEDED",
      },
      {
        consumptionLogId: "untagged",
        bookingAssetId: null,
        sourceKey: null,
        quantity: 5,
        origin: "OVERFLOW",
      },
    ]);
  });

  it("one 8-unit untagged return over standalone and kit with 5 out each", () => {
    // The kit slice sorts first by id; standalone still fills first.
    const slices = [
      slice("a-kit", 5, 5, { assetKitId: "ak1" }),
      slice("b-standalone", 5, 5),
    ];
    const shares = computeCandidateShares({
      slices,
      logs: [log("ret", 8, 1)],
    });

    expect(shares.map((s) => [s.bookingAssetId, s.quantity])).toEqual([
      ["b-standalone", 5],
      ["a-kit", 3],
    ]);
  });

  it("one untagged log spanning three slices", () => {
    const slices = [slice("s1", 2, 0), slice("s2", 3, 0), slice("s3", 4, 0)];
    const shares = computeCandidateShares({
      slices,
      logs: [log("ret", 7, 1)],
    });

    expect(
      shares.map((s) => [s.consumptionLogId, s.bookingAssetId, s.quantity])
    ).toEqual([
      ["ret", "s1", 2],
      ["ret", "s2", 3],
      ["ret", "s3", 2],
    ]);
  });

  it("out-of-group tag becomes OVERFLOW", () => {
    const slices = [slice("s1", 5, 5)];
    const shares = computeCandidateShares({
      slices,
      logs: [log("stray", 4, 1, "elsewhere")],
    });

    expect(shares).toEqual([
      {
        consumptionLogId: "stray",
        bookingAssetId: null,
        sourceKey: null,
        quantity: 4,
        origin: "OVERFLOW",
      },
    ]);
  });

  it("property: per-slice candidate totals equal attributeDispositionsByBookingAsset", () => {
    const rand = prng(20261111);
    for (let i = 0; i < 500; i++) {
      const { slices, logs } = generateGroup(rand);
      const shares = computeCandidateShares({ slices, logs });

      const expected = greedyTotals(slices, logs);
      const actual = totalsBySlice(shares);
      for (const s of slices) {
        expect(actual.get(s.id) ?? 0).toBe(expected.get(s.id) ?? 0);
      }

      // Every log stays fully shared.
      for (const l of logs) {
        const sum = shares
          .filter((s) => s.consumptionLogId === l.id)
          .reduce((acc, s) => acc + s.quantity, 0);
        expect(sum).toBe(l.quantity);
      }
    }
  });
});

describe("planGroupConversion", () => {
  it("gate: Q5 D10 S0 held back", () => {
    const plan = planGroupConversion({
      slices: [slice("s1", 5, 10)],
      logs: [],
      poolHasPlacements: true,
    });

    expect(plan).toEqual({
      status: "held_back",
      slices: [{ id: "s1", Q: 5, D: 10, S: 0 }],
    });
  });

  it("S > D: Q5 D3 S5 re-marks the latest 2 units OVERFLOW", () => {
    const plan = planGroupConversion({
      slices: [slice("s1", 5, 3, { sourceLocationId: "loc-a" })],
      logs: [log("early", 2, 1, "s1"), log("late", 3, 2, "s1")],
      poolHasPlacements: true,
    });

    if (plan.status !== "convert") throw new Error("expected convert");
    expect(plan.shares).toEqual([
      {
        consumptionLogId: "early",
        bookingAssetId: "s1",
        sourceKey: "LOCATION:loc-a",
        quantity: 2,
        origin: "SEEDED",
      },
      {
        consumptionLogId: "late",
        bookingAssetId: "s1",
        sourceKey: "LOCATION:loc-a",
        quantity: 1,
        origin: "SEEDED",
      },
      {
        consumptionLogId: "late",
        bookingAssetId: null,
        sourceKey: null,
        quantity: 2,
        origin: "OVERFLOW",
      },
    ]);
    expect(plan.rowsBySlice.get("s1")).toEqual([
      {
        kind: "LOCATION",
        locationId: "loc-a",
        quantity: 3,
        outQuantity: 0,
        releasedQuantity: 3,
        dispatchedTotal: 3,
        sharedQuantity: 3,
      },
    ]);
    expect(plan.pendingToAllocateBySlice.get("s1")).toBe(2);
    expect(plan.modeBySlice.get("s1")).toBe("AUTO");
  });

  it("seed unknown origin Q5 D10 S10", () => {
    const plan = planGroupConversion({
      slices: [slice("s1", 5, 10)],
      logs: [log("r1", 5, 1), log("r2", 5, 2)],
      poolHasPlacements: true,
    });

    if (plan.status !== "convert") throw new Error("expected convert");
    expect(plan.rowsBySlice.get("s1")).toEqual([
      {
        kind: "UNKNOWN",
        locationId: null,
        quantity: 0,
        outQuantity: 0,
        releasedQuantity: 0,
        dispatchedTotal: 10,
        sharedQuantity: 10,
      },
      {
        kind: "UNASSIGNED",
        locationId: null,
        quantity: 5,
        outQuantity: 0,
        releasedQuantity: 5,
        dispatchedTotal: 0,
        sharedQuantity: 0,
      },
    ]);
    expect(plan.pendingToAllocateBySlice.get("s1")).toBe(0);
    expect(plan.shares.map((s) => [s.sourceKey, s.quantity])).toEqual([
      ["UNKNOWN:", 5],
      ["UNKNOWN:", 5],
    ]);
  });

  it("seeds an UNPLACED carrier when nothing was recorded and the pool had no placements", () => {
    const plan = planGroupConversion({
      slices: [slice("s1", 5, 10)],
      logs: [log("r1", 5, 1), log("r2", 5, 2)],
      poolHasPlacements: false,
    });

    if (plan.status !== "convert") throw new Error("expected convert");
    expect(plan.rowsBySlice.get("s1")).toEqual([
      {
        kind: "UNPLACED",
        locationId: null,
        quantity: 5,
        outQuantity: 0,
        releasedQuantity: 5,
        dispatchedTotal: 10,
        sharedQuantity: 10,
      },
    ]);
  });

  it("seed recorded source A", () => {
    const plan = planGroupConversion({
      slices: [slice("s1", 5, 10, { sourceLocationId: "loc-a" })],
      logs: [log("r1", 5, 1), log("r2", 5, 2)],
      poolHasPlacements: true,
    });

    if (plan.status !== "convert") throw new Error("expected convert");
    expect(plan.rowsBySlice.get("s1")).toEqual([
      {
        kind: "LOCATION",
        locationId: "loc-a",
        quantity: 5,
        outQuantity: 0,
        releasedQuantity: 5,
        dispatchedTotal: 10,
        sharedQuantity: 10,
      },
    ]);
  });

  it("kit slice seeds one KIT row with out, pending, released and history", () => {
    // Q6 D4 S1: out 3, pending 2, released 1.
    const plan = planGroupConversion({
      slices: [slice("k1", 6, 4, { assetKitId: "ak1" })],
      logs: [log("r1", 1, 1)],
      poolHasPlacements: true,
    });

    if (plan.status !== "convert") throw new Error("expected convert");
    expect(plan.rowsBySlice.get("k1")).toEqual([
      {
        kind: "KIT",
        locationId: null,
        quantity: 6,
        outQuantity: 3,
        releasedQuantity: 1,
        dispatchedTotal: 4,
        sharedQuantity: 1,
      },
    ]);
    expect(plan.modeBySlice.get("k1")).toBe("KIT");
    expect(plan.pendingToAllocateBySlice.get("k1")).toBe(0);
    expect(plan.shares).toEqual([
      {
        consumptionLogId: "r1",
        bookingAssetId: "k1",
        sourceKey: "KIT:",
        quantity: 1,
        origin: "SEEDED",
      },
    ]);
  });

  it("every seeded row has no violations", () => {
    const rand = prng(42);
    let converted = 0;
    for (let i = 0; i < 500; i++) {
      const { slices, logs, poolHasPlacements } = generateGroup(rand);
      const plan = planGroupConversion({ slices, logs, poolHasPlacements });
      if (plan.status !== "convert") continue;
      converted++;

      for (const l of logs) {
        const sum = plan.shares
          .filter((s) => s.consumptionLogId === l.id)
          .reduce((acc, s) => acc + s.quantity, 0);
        expect(sum).toBe(l.quantity);
      }

      for (const s of slices) {
        const rows = plan.rowsBySlice.get(s.id) ?? [];
        for (const r of rows) expect(sourceRowViolations(r)).toEqual([]);

        // Shares on the slice land on its carrier, which holds them all.
        const sliceShares = plan.shares.filter(
          (sh) => sh.bookingAssetId === s.id
        );
        const shared = sliceShares.reduce((acc, sh) => acc + sh.quantity, 0);
        expect(rows.reduce((acc, r) => acc + r.sharedQuantity, 0)).toBe(shared);
        expect(shared).toBeLessThanOrEqual(s.checkedOutQuantity);

        // Rows plus pending left to allocate cover exactly the booked units.
        const planned = rows.reduce((acc, r) => acc + r.quantity, 0);
        expect(planned + (plan.pendingToAllocateBySlice.get(s.id) ?? 0)).toBe(
          s.quantity
        );
        expect(plan.modeBySlice.get(s.id)).toBe(
          s.assetKitId === null ? "AUTO" : "KIT"
        );
      }

      for (const sh of plan.shares) {
        if (sh.bookingAssetId === null) {
          expect(sh.sourceKey).toBeNull();
          expect(sh.origin).toBe("OVERFLOW");
        } else {
          expect(sh.sourceKey).not.toBeNull();
          expect(sh.quantity).toBeGreaterThan(0);
        }
      }
    }
    expect(converted).toBeGreaterThan(20);
  });
});
