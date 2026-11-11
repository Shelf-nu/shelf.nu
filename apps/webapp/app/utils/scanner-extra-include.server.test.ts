// @vitest-environment node
/**
 * Tests for the scanner extra-include sanitizer.
 *
 * The sanitizer keeps an allowlisted relation only as a flat select of its
 * allowlisted SCALAR fields. These tests pin that a relation name inside a
 * select (which Prisma would load as a whole row), unknown keys, `include`
 * and deep nesting are all stripped, and that a bare `relation: true` is
 * narrowed instead of loading every column.
 *
 * @see {@link file://./scanner-extra-include.server.ts}
 */
import {
  sanitizeAssetExtraInclude,
  sanitizeKitExtraInclude,
} from "./scanner-extra-include.server";

describe("sanitizeAssetExtraInclude", () => {
  it("keeps allowlisted scalar fields on an allowlisted relation", () => {
    expect(
      sanitizeAssetExtraInclude({
        category: { select: { id: true, name: true, color: true } },
      })
    ).toEqual({
      category: { select: { id: true, name: true, color: true } },
    });
  });

  it("narrows a bare `relation: true` to the allowlisted scalars", () => {
    expect(sanitizeAssetExtraInclude({ category: true })).toEqual({
      category: { select: { id: true, name: true, color: true } },
    });
  });

  it("strips a relation selected inside an allowlisted relation", () => {
    // `assets: true` inside a select loads every asset in the category.
    expect(
      sanitizeAssetExtraInclude({ category: { select: { assets: true } } })
    ).toBeUndefined();
    // The creator's full User row.
    expect(
      sanitizeAssetExtraInclude({
        category: { select: { id: true, user: true } },
      })
    ).toEqual({ category: { select: { id: true } } });
  });

  it("drops unknown and false scalar keys, keeping the allowlisted ones", () => {
    expect(
      sanitizeAssetExtraInclude({
        category: {
          select: {
            id: true,
            name: false,
            description: true,
            organizationId: true,
            notAField: true,
          },
        },
      })
    ).toEqual({ category: { select: { id: true } } });
  });

  it("drops relations that are not on the asset allowlist", () => {
    // `Asset` has no direct `kit` / `location` relation; those live on the
    // pivots that ASSET_INCLUDE already selects.
    expect(
      sanitizeAssetExtraInclude({
        organization: true,
        bookingAssets: { include: { booking: true } },
        notes: true,
        custody: true,
        kit: { select: { id: true, name: true } },
        location: { select: { id: true, name: true } },
        category: { select: { id: true } },
      })
    ).toEqual({ category: { select: { id: true } } });
    // A kit's custodian reached through a scanned asset.
    expect(
      sanitizeAssetExtraInclude({ kit: { select: { custody: true } } })
    ).toBeUndefined();
  });

  it("drops the pivot shapes ASSET_INCLUDE already provides", () => {
    // These are the payloads the location and kit scanner drawers render
    // from. ASSET_INCLUDE always selects them, so the extra include must not
    // reopen nested relation traversal for them.
    expect(
      sanitizeAssetExtraInclude({
        assetLocations: {
          select: { location: { select: { id: true, name: true } } },
        },
      })
    ).toBeUndefined();
    expect(
      sanitizeAssetExtraInclude({
        assetKits: {
          select: {
            kitId: true,
            kit: { select: { id: true, name: true } },
          },
        },
      })
    ).toBeUndefined();
  });

  it("rejects `include`, nested selects and extra keys beside `select`", () => {
    expect(
      sanitizeAssetExtraInclude({
        category: { include: { assets: { include: { bookings: true } } } },
      })
    ).toBeUndefined();
    expect(
      sanitizeAssetExtraInclude({
        category: { select: { assets: { select: { bookings: true } } } },
      })
    ).toBeUndefined();
    expect(
      sanitizeAssetExtraInclude({
        category: { select: { id: true }, where: { id: "x" } },
      })
    ).toBeUndefined();
  });

  it("ignores prototype keys", () => {
    expect(
      sanitizeAssetExtraInclude(
        JSON.parse('{"toString":true,"constructor":true}')
      )
    ).toBeUndefined();
  });

  it("returns undefined for non-objects, arrays and empty results", () => {
    expect(sanitizeAssetExtraInclude(undefined)).toBeUndefined();
    expect(sanitizeAssetExtraInclude("category")).toBeUndefined();
    expect(sanitizeAssetExtraInclude([{ category: true }])).toBeUndefined();
    expect(sanitizeAssetExtraInclude({ category: false })).toBeUndefined();
    expect(sanitizeAssetExtraInclude({ organization: true })).toBeUndefined();
  });
});

describe("sanitizeKitExtraInclude", () => {
  it("keeps allowlisted scalars on location and category", () => {
    expect(
      sanitizeKitExtraInclude({
        location: { select: { id: true, name: true } },
        category: { select: { name: true } },
      })
    ).toEqual({
      location: { select: { id: true, name: true } },
      category: { select: { name: true } },
    });
  });

  it("narrows a bare `relation: true` to the allowlisted scalars", () => {
    expect(sanitizeKitExtraInclude({ location: true })).toEqual({
      location: { select: { id: true, name: true } },
    });
  });

  it("strips relations selected inside location", () => {
    // Custody rows (teamMemberId, quantity) that would bypass the
    // custody-visibility redaction.
    expect(
      sanitizeKitExtraInclude({ location: { select: { custodies: true } } })
    ).toBeUndefined();
    // The location creator's full User row.
    expect(
      sanitizeKitExtraInclude({ location: { select: { user: true } } })
    ).toBeUndefined();
    expect(
      sanitizeKitExtraInclude({
        location: {
          select: { id: true, custodies: true, user: true, address: true },
        },
      })
    ).toEqual({ location: { select: { id: true } } });
  });

  it("drops relations that are not on the kit allowlist", () => {
    // `custody` is the kit's custodian; it stays behind the redaction that
    // KIT_INCLUDE feeds, never an extra include.
    expect(
      sanitizeKitExtraInclude({
        custody: true,
        assetKits: { include: { asset: true } },
        organization: true,
        createdBy: true,
      })
    ).toBeUndefined();
    expect(
      sanitizeKitExtraInclude({ category: { select: { assets: true } } })
    ).toBeUndefined();
  });
});
