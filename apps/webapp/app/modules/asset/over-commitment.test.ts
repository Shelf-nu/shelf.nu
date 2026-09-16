/**
 * Tests for the over-commitment derivation.
 *
 * The load-bearing case is the busy asset: many upcoming bookings whose SUM
 * dwarfs the pool while no single booking exceeds it. That is healthy data and
 * must not raise an alarm.
 *
 * @see {@link file://./over-commitment.ts}
 */

import { describe, expect, it } from "vitest";
import { resolveOverCommitment } from "./over-commitment";
import type { OverCommitmentInput } from "./over-commitment";

/** A pool of ten with nothing claimed. Override only what a case is about. */
function pool(
  overrides: Partial<OverCommitmentInput> = {}
): OverCommitmentInput {
  return {
    total: 10,
    inCustody: 0,
    inKits: 0,
    checkedOut: 0,
    bookingSlices: [],
    ...overrides,
  };
}

/** One RESERVED slice. */
function reserved(quantity: number, id: string, name = `Booking ${id}`) {
  return { quantity, booking: { id, name, status: "RESERVED" } };
}

describe("resolveOverCommitment", () => {
  it("names the booking that asks for more than the pool", () => {
    const result = resolveOverCommitment(
      pool({ bookingSlices: [reserved(12, "b1", "ZZX Stress")] })
    );

    expect(result).toEqual({
      shortBy: 2,
      asks: 12,
      booking: { id: "b1", name: "ZZX Stress" },
    });
  });

  it("stays silent for a busy asset whose bookings never overlap", () => {
    // why: THE false-alarm case. Fifty single-unit bookings against a pool of
    // ten sum to fifty, but peak demand is one. Summing would report a
    // permanent shortage on the healthiest, busiest assets.
    const slices = Array.from({ length: 50 }, (_, i) => reserved(1, `b${i}`));

    expect(resolveOverCommitment(pool({ bookingSlices: slices }))).toBeNull();
  });

  it("adds several slices of the SAME booking together", () => {
    // why: one booking can hold a standalone slice and a kit-driven slice for
    // the same asset. Judging them separately would miss a real over-commit.
    const result = resolveOverCommitment(
      pool({
        bookingSlices: [reserved(6, "b1", "Gala"), reserved(6, "b1", "Gala")],
      })
    );

    expect(result?.asks).toBe(12);
    expect(result?.shortBy).toBe(2);
  });

  it("counts custody and kits toward the shortfall", () => {
    // why: the figure must match `classifyStockStatus`, or the asset page and
    // the index would state different numbers for the same row.
    const result = resolveOverCommitment(
      pool({
        inCustody: 4,
        inKits: 2,
        bookingSlices: [reserved(6, "b1")],
      })
    );

    expect(result?.shortBy).toBe(2);
    expect(result?.asks).toBe(6);
  });

  it("ignores bookings that are not upcoming", () => {
    // why: an ONGOING booking's units are already counted in `checkedOut`.
    // Counting them here as well would double-report them.
    const slices = [
      { quantity: 12, booking: { id: "b1", name: "Out", status: "ONGOING" } },
    ];

    expect(resolveOverCommitment(pool({ bookingSlices: slices }))).toBeNull();
  });

  it("returns null for an individually-tracked asset", () => {
    expect(
      resolveOverCommitment(
        pool({ total: null, bookingSlices: [reserved(1, "b1")] })
      )
    ).toBeNull();
  });

  it("reports the shortfall even when the booking cannot be identified", () => {
    // why: a missing id must not hide a real over-commitment — the number is
    // still true, we just cannot link anywhere.
    const result = resolveOverCommitment(
      pool({ inCustody: 12, bookingSlices: [] })
    );

    expect(result?.shortBy).toBe(2);
    expect(result?.booking).toBeNull();
  });
});
