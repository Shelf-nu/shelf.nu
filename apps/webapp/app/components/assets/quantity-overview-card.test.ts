import { describe, expect, it } from "vitest";

import { describeOverCommitment } from "./quantity-overview-card";

/**
 * The over-commitment callout is the load-bearing honesty of the quantity
 * work: it is what replaces a raw "-3 available". These tests lock the two
 * properties that make it trustworthy — it never names a cause that isn't
 * consuming units, and it never omits a cure that would actually work.
 *
 * Regression guard for the original copy, which blamed bookings
 * unconditionally and never mentioned releasing custody.
 *
 * @see {@link file://./quantity-overview-card.tsx}
 */
describe("describeOverCommitment", () => {
  it("blames only bookings when bookings are the sole commitment", () => {
    const { causeLabel, cureLabel } = describeOverCommitment({
      reserved: 8,
      inCustody: 0,
      checkedOut: 0,
      inKits: 0,
    });

    expect(causeLabel).toBe("bookings");
    // No custody exists, so "release custody" must NOT be offered.
    expect(cureLabel).toBe(
      "reduce or remove this asset from a booking, or increase the total quantity"
    );
  });

  it("names custody — not bookings — when custody alone consumes the pool", () => {
    const { causeLabel, cureLabel } = describeOverCommitment({
      reserved: 0,
      inCustody: 6,
      checkedOut: 0,
      inKits: 0,
    });

    expect(causeLabel).toBe("custody");
    expect(causeLabel).not.toContain("bookings");
    expect(cureLabel).toBe("release custody, or increase the total quantity");
  });

  it("names both causes and both cures for the mixed case the old copy got wrong", () => {
    // The exact shape that made the old sentence false: bookings reserved
    // EXACTLY stock (5 of 5) while custody held the rest.
    const { causeLabel, cureLabel } = describeOverCommitment({
      reserved: 5,
      inCustody: 5,
      checkedOut: 0,
      inKits: 0,
    });

    expect(causeLabel).toBe("bookings and custody");
    expect(cureLabel).toContain("release custody");
    expect(cureLabel).toContain("reduce or remove this asset from a booking");
  });

  it("lists every contributing bucket, including check-outs and kits", () => {
    const { causeLabel } = describeOverCommitment({
      reserved: 1,
      inCustody: 2,
      checkedOut: 3,
      inKits: 4,
    });

    expect(causeLabel).toBe("bookings, custody, check-outs and kits");
  });

  it("always offers increasing the quantity, even with no other cure available", () => {
    // Reachable when check-outs/kits alone over-commit: neither has a cure
    // the user can apply from this card.
    const { causeLabel, cureLabel } = describeOverCommitment({
      reserved: 0,
      inCustody: 0,
      checkedOut: 4,
      inKits: 0,
    });

    expect(causeLabel).toBe("check-outs");
    expect(cureLabel).toBe("increase the total quantity");
  });
});
