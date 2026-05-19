// @vitest-environment node
/**
 * Tests for the scanner extra-include sanitizer (V-003 hardening).
 *
 * Asserts the security-relevant behavior: legitimate scanner-drawer shapes
 * pass through unchanged, while disallowed keys and injectable shapes
 * (`include`, deep nesting, arrays) are stripped.
 *
 * @see {@link file://./scanner-extra-include.server.ts}
 */
import {
  sanitizeAssetExtraInclude,
  sanitizeKitExtraInclude,
} from "./scanner-extra-include.server";

describe("sanitizeAssetExtraInclude", () => {
  it("keeps the exact shapes the scanner drawers send", () => {
    expect(
      sanitizeAssetExtraInclude({ kit: { select: { id: true, name: true } } })
    ).toEqual({ kit: { select: { id: true, name: true } } });

    expect(
      sanitizeAssetExtraInclude({
        location: { select: { id: true, name: true } },
      })
    ).toEqual({ location: { select: { id: true, name: true } } });

    expect(sanitizeAssetExtraInclude({ category: true })).toEqual({
      category: true,
    });
  });

  it("drops disallowed top-level relations (overfetch / PII traversal)", () => {
    expect(
      sanitizeAssetExtraInclude({
        organization: true,
        bookings: { include: { custodianUser: true } },
        notes: true,
        kit: { select: { id: true } },
      })
    ).toEqual({ kit: { select: { id: true } } });
  });

  it("rejects injectable value shapes (include / deep nesting)", () => {
    // allowed key, but `include` (relation traversal) is not an allowed shape
    expect(
      sanitizeAssetExtraInclude({
        kit: { include: { assets: { include: { bookings: true } } } },
      })
    ).toBeUndefined();
  });

  it("returns undefined for non-objects, arrays and empty results", () => {
    expect(sanitizeAssetExtraInclude(undefined)).toBeUndefined();
    expect(sanitizeAssetExtraInclude("kit")).toBeUndefined();
    expect(sanitizeAssetExtraInclude([{ kit: true }])).toBeUndefined();
    expect(sanitizeAssetExtraInclude({ organization: true })).toBeUndefined();
  });
});

describe("sanitizeKitExtraInclude", () => {
  it("allows only its allowlisted keys and safe shapes", () => {
    expect(
      sanitizeKitExtraInclude({
        category: true,
        assets: { include: { bookings: true } },
      })
    ).toEqual({ category: true });
  });

  it("drops everything when nothing is allowlisted", () => {
    expect(
      sanitizeKitExtraInclude({ assets: true, organization: true })
    ).toBeUndefined();
  });
});
