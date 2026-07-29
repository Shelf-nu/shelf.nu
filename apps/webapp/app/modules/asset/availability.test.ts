/**
 * Property tests for the pure booking-pool availability core.
 *
 * These are behavior tests over the whole input grid — no Prisma, no mocks:
 * the module is a pure function by design (client-bundled consumers). The
 * key property under test is the clamp contract that kills the historical
 * clamp-flag ambiguity: every variant of the formula must agree on the sign
 * (`raw`) and `available` must equal `max(0, raw)` for EVERY input combo.
 *
 * @see {@link file://./availability.ts}
 */

import { describe, expect, it } from "vitest";
import type { BookingPoolInputs } from "./availability";
import {
  computeBookingPoolAvailability,
  splitDisplayBookingCommitments,
} from "./availability";

/**
 * Small exhaustive grid — covers healthy, exactly-zero, and over-committed
 * pools, including the optional-field-omitted variants each migrated
 * surface uses (badge omits inKits; model pool omits inKits + checkedOut).
 */
const GRID: BookingPoolInputs[] = [];
for (const total of [0, 1, 10, 100]) {
  for (const inCustody of [0, 3, 10]) {
    for (const reserved of [0, 5, 12]) {
      for (const checkedOut of [undefined, 0, 4, 20]) {
        for (const inKits of [undefined, 0, 2, 15]) {
          GRID.push({ total, inCustody, reserved, checkedOut, inKits });
        }
      }
    }
  }
}

describe("computeBookingPoolAvailability", () => {
  it("holds `available === max(0, raw)` across the whole input grid (clamp contract)", () => {
    for (const inputs of GRID) {
      const { raw, available } = computeBookingPoolAvailability(inputs);
      expect(available).toBe(Math.max(0, raw));
      // Display value can never lie negative…
      expect(available).toBeGreaterThanOrEqual(0);
      // …and never exceeds the signed truth by more than the clamp.
      expect(available >= raw).toBe(true);
    }
  });

  it("computes raw as total − inKits − inCustody − reserved − checkedOut", () => {
    for (const inputs of GRID) {
      const { raw } = computeBookingPoolAvailability(inputs);
      expect(raw).toBe(
        inputs.total -
          (inputs.inKits ?? 0) -
          inputs.inCustody -
          inputs.reserved -
          (inputs.checkedOut ?? 0)
      );
    }
  });

  it("treats omitted optional buckets exactly like zeros (surface variants agree)", () => {
    // The badge surface omits inKits; the model-request surface omits both
    // optional buckets. Both must be the SAME formula, not a different one.
    expect(
      computeBookingPoolAvailability({ total: 10, inCustody: 2, reserved: 3 })
    ).toEqual(
      computeBookingPoolAvailability({
        total: 10,
        inCustody: 2,
        reserved: 3,
        checkedOut: 0,
        inKits: 0,
      })
    );
  });

  it("reports oversubscription as a negative raw with a clamped available of 0", () => {
    // The #2724 scenario: total 10, other bookings reserved 17.
    const { raw, available } = computeBookingPoolAvailability({
      total: 10,
      inCustody: 0,
      reserved: 17,
    });
    expect(raw).toBe(-7);
    expect(available).toBe(0);
  });

  it("returns full stock when nothing is committed", () => {
    const { raw, available } = computeBookingPoolAvailability({
      total: 42,
      inCustody: 0,
      reserved: 0,
    });
    expect(raw).toBe(42);
    expect(available).toBe(42);
  });
});

/**
 * The asset-overview card renders "Reserved (bookings)", "Checked out
 * (bookings)" and "Available" as a ledger. Users add them up. These tests
 * lock the reconciliation identity that makes that ledger true:
 *
 *   total − inKits − inCustody − reserved − checkedOut === raw
 *
 * Regression guard for the shipped bug: the display rows were built from raw
 * `BookingAsset.quantity` sums while `available` came from the
 * disposition-aware pool, so after a CONSUME/LOSS/DAMAGE partial check-in the
 * card rendered phantom units and the rows no longer summed to stock.
 *
 * @see {@link file://./availability.ts}
 * @see {@link file://./../../routes/_layout+/assets.$assetId.overview.tsx}
 */
describe("splitDisplayBookingCommitments", () => {
  it("reconciles the card after a CONSUME partial check-in (the shipped bug)", () => {
    // Stock was 100; an ONGOING booking reserved 10 and scanned all 10 out.
    // A partial check-in then CONSUMEd 4: `Asset.quantity` dropped to 96 and
    // the disposition-aware pool now sees only 6 outstanding on that booking.
    const total = 96;
    const { reserved, checkedOut } = splitDisplayBookingCommitments({
      poolReserved: 0,
      poolActive: 6,
      rawActiveBooked: 10,
      scannedOut: 10,
    });

    // The 4 consumed units are gone — they must not resurface as "reserved".
    expect(reserved).toBe(0);
    expect(checkedOut).toBe(6);

    const { raw, available } = computeBookingPoolAvailability({
      total,
      inKits: 0,
      inCustody: 0,
      reserved,
      checkedOut,
    });
    expect(available).toBe(90);
    // The identity the card's rows are read as. Pre-fix this was 100 ≠ 96.
    expect(reserved + checkedOut + available).toBe(total);
    expect(total - 0 - 0 - reserved - checkedOut).toBe(raw);
  });

  it("keeps the booked-but-not-yet-scanned-out remainder in the reserved row", () => {
    // No dispositions: 10 booked on an ONGOING booking, only 6 scanned out.
    // This is the pre-existing behavior the fix must not regress.
    const { reserved, checkedOut } = splitDisplayBookingCommitments({
      poolReserved: 0,
      poolActive: 10,
      rawActiveBooked: 10,
      scannedOut: 6,
    });

    expect(checkedOut).toBe(6);
    expect(reserved).toBe(4);
  });

  it("attributes a disposition to the scanned-out units, not the shelf units", () => {
    // 10 booked, 6 scanned out, then 2 of those 6 CONSUMEd (stock 100 → 98).
    // Truth: 4 still off the shelf, 4 still owed but never scanned out.
    const total = 98;
    const { reserved, checkedOut } = splitDisplayBookingCommitments({
      poolReserved: 0,
      poolActive: 8,
      rawActiveBooked: 10,
      scannedOut: 6,
    });

    expect(checkedOut).toBe(4);
    expect(reserved).toBe(4);
    expect(
      computeBookingPoolAvailability({
        total,
        inKits: 0,
        inCustody: 0,
        reserved,
        checkedOut,
      }).available
    ).toBe(90);
    expect(reserved + checkedOut + 90).toBe(total);
  });

  it("preserves the pool total across the whole input grid (identity property)", () => {
    for (const poolReserved of [0, 3, 11]) {
      for (const poolActive of [0, 5, 10]) {
        // Raw booked is always ≥ the disposition-adjusted commitment.
        for (const disposed of [0, 2, 5, 12]) {
          for (const scannedOut of [0, 3, 10, 25]) {
            const { reserved, checkedOut } = splitDisplayBookingCommitments({
              poolReserved,
              poolActive,
              rawActiveBooked: poolActive + disposed,
              scannedOut,
            });

            // Total-preserving: the rows re-partition, never invent or drop.
            expect(reserved + checkedOut).toBe(poolReserved + poolActive);
            // Neither row can render a negative or an out-of-band value.
            expect(reserved).toBeGreaterThanOrEqual(0);
            expect(checkedOut).toBeGreaterThanOrEqual(0);
            expect(checkedOut).toBeLessThanOrEqual(poolActive);

            // …and therefore the card's ledger closes for every combination.
            const total = 100;
            const inKits = 4;
            const inCustody = 7;
            const { raw } = computeBookingPoolAvailability({
              total,
              inKits,
              inCustody,
              reserved,
              checkedOut,
            });
            expect(total - inKits - inCustody - reserved - checkedOut).toBe(
              raw
            );
          }
        }
      }
    }
  });
});
