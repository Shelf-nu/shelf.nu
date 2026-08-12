/**
 * The "Includes unavailable assets" badge.
 *
 * Pinned against a real customer report (University of York, 2026-08-07): a
 * QUANTITY_TRACKED asset with some units assigned to a custodian, the free
 * units booked successfully, and the booking still labelled as containing
 * unavailable assets. The booking was valid and checked out fine — the badge
 * was simply wrong.
 *
 * The tests below fix that case WITHOUT weakening the badge: everything it
 * legitimately warns about must still warn.
 *
 * @see {@link file://./booking-assets.ts} — `bookingIncludesUnavailableAssets`
 */
import { AssetType } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { bookingIncludesUnavailableAssets } from "./booking-assets";

const qtAsset = (custodyRows: number) => ({
  availableToBook: true,
  type: AssetType.QUANTITY_TRACKED,
  custody: Array.from({ length: custodyRows }, () => ({})),
});

const individualAsset = (custodyRows: number) => ({
  availableToBook: true,
  type: AssetType.INDIVIDUAL,
  custody: Array.from({ length: custodyRows }, () => ({})),
});

describe("bookingIncludesUnavailableAssets", () => {
  it("does NOT warn for a quantity-tracked asset with some units in custody", () => {
    // The reported case. Custody on a QT asset means SOME units are allocated;
    // the rest are bookable, which is exactly what the customer booked.
    expect(bookingIncludesUnavailableAssets([qtAsset(1)], "RESERVED")).toBe(
      false
    );
  });

  it("does NOT warn when several custodians hold units of the same QT asset", () => {
    // Multiple custody rows is still "some units allocated", not "none free".
    expect(bookingIncludesUnavailableAssets([qtAsset(3)], "DRAFT")).toBe(false);
  });

  it("STILL warns for an INDIVIDUAL asset in custody", () => {
    // One indivisible thing. If someone holds it, the booking cannot have it.
    expect(
      bookingIncludesUnavailableAssets([individualAsset(1)], "RESERVED")
    ).toBe(true);
  });

  it("STILL warns for an asset flagged not-available-to-book, whatever its type", () => {
    // An explicit operator decision, independent of custody or type.
    for (const type of [AssetType.INDIVIDUAL, AssetType.QUANTITY_TRACKED]) {
      expect(
        bookingIncludesUnavailableAssets(
          [{ availableToBook: false, type, custody: [] }],
          "RESERVED"
        )
      ).toBe(true);
    }
  });

  it("warns when a mixed booking contains one genuinely unavailable asset", () => {
    // The QT asset must not mask a real problem sitting next to it.
    expect(
      bookingIncludesUnavailableAssets(
        [qtAsset(2), individualAsset(1)],
        "RESERVED"
      )
    ).toBe(true);
  });

  it("does not warn on terminal bookings", () => {
    // The badge is about what can still go wrong. Nothing can.
    for (const status of ["COMPLETE", "CANCELLED", "ARCHIVED"]) {
      expect(
        bookingIncludesUnavailableAssets([individualAsset(1)], status)
      ).toBe(false);
    }
  });

  it("tolerates a missing custody relation", () => {
    expect(
      bookingIncludesUnavailableAssets(
        [{ availableToBook: true, type: AssetType.INDIVIDUAL, custody: null }],
        "RESERVED"
      )
    ).toBe(false);
  });

  it("does not warn on an empty booking", () => {
    expect(bookingIncludesUnavailableAssets([], "DRAFT")).toBe(false);
  });
});
