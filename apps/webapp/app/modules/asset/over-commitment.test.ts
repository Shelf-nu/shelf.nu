/**
 * Tests for the over-commitment derivation.
 *
 * The load-bearing cases are the healthy ones: a busy asset whose bookings
 * never overlap, and a pool out today and booked again after it returns. Both
 * arrive here as a low `peakBooked`, and both must stay silent.
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
    peakBooked: 0,
    topBooking: null,
    ...overrides,
  };
}

describe("resolveOverCommitment", () => {
  it("names the biggest booking when the peak exceeds the pool", () => {
    const result = resolveOverCommitment(
      pool({
        peakBooked: 12,
        topBooking: { id: "b1", name: "ZZX Stress", units: 12 },
      })
    );
    expect(result).toEqual({
      shortBy: 2,
      peak: 12,
      held: 0,
      booking: { id: "b1", name: "ZZX Stress", units: 12 },
    });
  });

  it("stays silent for a busy asset whose bookings never overlap", () => {
    expect(
      resolveOverCommitment(
        pool({
          peakBooked: 1,
          topBooking: { id: "b7", name: "Weekly", units: 1 },
        })
      )
    ).toBeNull();
  });

  it("stays silent for a pool out today and booked again after it returns", () => {
    expect(resolveOverCommitment(pool({ peakBooked: 8 }))).toBeNull();
  });

  it("flags two overlapping bookings that only exceed the pool together", () => {
    const result = resolveOverCommitment(
      pool({ peakBooked: 12, topBooking: { id: "b1", name: "Gala", units: 6 } })
    );
    expect(result?.shortBy).toBe(2);
    expect(result?.peak).toBe(12);
    expect(result?.booking?.units).toBe(6);
  });

  it("counts custody and kits toward the shortfall", () => {
    const result = resolveOverCommitment(
      pool({ inCustody: 4, inKits: 2, peakBooked: 6 })
    );
    expect(result?.shortBy).toBe(2);
    expect(result?.peak).toBe(6);
    expect(result?.held).toBe(6);
  });

  it("returns null for an individually-tracked asset", () => {
    expect(
      resolveOverCommitment(pool({ total: null, peakBooked: 1 }))
    ).toBeNull();
  });

  it("reports the shortfall even when no booking is involved", () => {
    const result = resolveOverCommitment(pool({ inCustody: 12 }));
    expect(result?.shortBy).toBe(2);
    expect(result?.booking).toBeNull();
  });
});
