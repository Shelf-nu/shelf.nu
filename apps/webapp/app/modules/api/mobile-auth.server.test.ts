import { describe, expect, it, vi } from "vitest";

import { shapeMobileAssetResponse } from "~/modules/api/mobile-auth.server";

// why: importing the module transitively loads `~/database/db.server`, which
// instantiates a real Prisma client and tries to connect at module load — under
// `pnpm test:run` (no DB available) that triggers an unhandled rejection that
// fails the whole suite even though every test here is a pure unit test.
// Mocking the db module to an empty object short-circuits the connection.
vi.mock("~/database/db.server", () => ({ db: {} }));

/**
 * Tests for `shapeMobileAssetResponse` — the back-compat helper that flattens
 * the post-Phase-4a/4b asset pivot rows (`assetKits`, `assetLocations`,
 * 1:many `custody`) into the legacy flat shape consumed by the companion
 * app currently in App Store review (since 2026-05-20).
 *
 * The shape must preserve every top-level field from `MOBILE_ASSET_SELECT`
 * via `...rest`, and must surface the pivot/relation data as single-or-null
 * objects (`kit`, `kitId`, `location`, `custody`) so the in-review companion
 * keeps working without an update.
 *
 * @see {@link file://./mobile-auth.server.ts} for the helper implementation
 */

// why: a minimal valid `MOBILE_ASSET_SELECT` row used as the baseline for
// every test. Individual tests override only the fields they care about so
// the asserted output diffs stay readable. Quantity scalars default to the
// INDIVIDUAL-asset shape (`type: "INDIVIDUAL"`, null quantity columns).
const baseAsset = {
  id: "asset-123",
  title: "Test Asset",
  status: "AVAILABLE",
  mainImage: null,
  availableToBook: true,
  category: null,
  type: "INDIVIDUAL" as const,
  quantity: null,
  minQuantity: null,
  unitOfMeasure: null,
  consumptionType: null,
  assetKits: [],
  assetLocations: [],
  custody: [] as Array<{
    quantity: number;
    kitCustodyId: string | null;
    custodian: { id: string; name: string; userId: string | null };
  }>,
};

/**
 * Builds a custody row in the widened `MOBILE_ASSET_SELECT` shape. Operator
 * rows by default (`kitCustodyId: null`); pass `kitCustodyId` for
 * kit-allocated rows, `userId` for custodians linked to an auth user.
 */
function custodyRow(
  id: string,
  name: string,
  quantity: number,
  opts: { kitCustodyId?: string | null; userId?: string | null } = {}
) {
  return {
    quantity,
    kitCustodyId: opts.kitCustodyId ?? null,
    custodian: { id, name, userId: opts.userId ?? null },
  };
}

describe("shapeMobileAssetResponse", () => {
  it("returns null for kit, kitId, location, and custody when all pivots are empty", () => {
    const result = shapeMobileAssetResponse(baseAsset);

    expect(result.kit).toBeNull();
    expect(result.kitId).toBeNull();
    expect(result.location).toBeNull();
    expect(result.custody).toBeNull();
  });

  it("flattens assetKits[0] to a top-level kit and synthesises kitId", () => {
    const result = shapeMobileAssetResponse({
      ...baseAsset,
      assetKits: [{ kit: { id: "kit-456", name: "Camera Bag" } }],
    });

    expect(result.kit).toEqual({ id: "kit-456", name: "Camera Bag" });
    expect(result.kitId).toBe("kit-456");
    // Sibling pivots stay null when only the kit pivot has rows.
    expect(result.location).toBeNull();
    expect(result.custody).toBeNull();
  });

  it("flattens custody[0] to a single-or-null object", () => {
    const result = shapeMobileAssetResponse({
      ...baseAsset,
      custody: [custodyRow("tm-789", "Alice Example", 1)],
    });

    expect(result.custody).toEqual({
      custodian: { id: "tm-789", name: "Alice Example", userId: null },
    });
    expect(result.kit).toBeNull();
    expect(result.location).toBeNull();
  });

  it("flattens assetLocations[0] to a top-level location", () => {
    const result = shapeMobileAssetResponse({
      ...baseAsset,
      assetLocations: [{ location: { id: "loc-321", name: "Studio A" } }],
    });

    expect(result.location).toEqual({ id: "loc-321", name: "Studio A" });
    expect(result.kit).toBeNull();
    expect(result.custody).toBeNull();
  });

  it("populates all three flattened fields when kit, location, and custody are all present", () => {
    const result = shapeMobileAssetResponse({
      ...baseAsset,
      assetKits: [{ kit: { id: "kit-1", name: "Audio Kit" } }],
      assetLocations: [{ location: { id: "loc-1", name: "Warehouse" } }],
      custody: [custodyRow("tm-1", "Bob Custodian", 1)],
    });

    expect(result.kit).toEqual({ id: "kit-1", name: "Audio Kit" });
    expect(result.kitId).toBe("kit-1");
    expect(result.location).toEqual({ id: "loc-1", name: "Warehouse" });
    expect(result.custody).toEqual({
      custodian: { id: "tm-1", name: "Bob Custodian", userId: null },
    });

    // Raw pivot arrays must not leak through — companion reads the flat
    // fields only and would choke on unexpected array properties.
    expect(result).not.toHaveProperty("assetKits");
    expect(result).not.toHaveProperty("assetLocations");
    // `custody` IS a key on the output but as a single object, not an array.
    expect(Array.isArray(result.custody)).toBe(false);
  });

  it("preserves top-level fields (mainImage, availableToBook, category) via ...rest", () => {
    const result = shapeMobileAssetResponse({
      ...baseAsset,
      mainImage: "https://example.com/img.jpg",
      availableToBook: false,
      category: { name: "Cameras" },
    });

    expect(result.id).toBe("asset-123");
    expect(result.title).toBe("Test Asset");
    expect(result.status).toBe("AVAILABLE");
    expect(result.mainImage).toBe("https://example.com/img.jpg");
    expect(result.availableToBook).toBe(false);
    expect(result.category).toEqual({ name: "Cameras" });
  });

  it("keeps legacy fields null AND surfaces the new quantity fields for an INDIVIDUAL asset with empty pivots", () => {
    // The new additive fields must coexist with the legacy back-compat
    // contract: a bare INDIVIDUAL asset still reports null kit/location/
    // custody, plus the quantity scalars pass through and `custodyList` is
    // an empty array (never undefined).
    const result = shapeMobileAssetResponse(baseAsset);

    // Legacy fields unchanged.
    expect(result.kit).toBeNull();
    expect(result.kitId).toBeNull();
    expect(result.location).toBeNull();
    expect(result.custody).toBeNull();

    // New additive fields.
    expect(result.type).toBe("INDIVIDUAL");
    expect(result.quantity).toBeNull();
    expect(result.minQuantity).toBeNull();
    expect(result.unitOfMeasure).toBeNull();
    expect(result.consumptionType).toBeNull();
    expect(result.custodyList).toEqual([]);
  });

  it("surfaces the many-aware custodyList for a QUANTITY_TRACKED asset with multiple custody rows", () => {
    // QUANTITY_TRACKED assets can have multiple holders. `custodyList` must
    // carry every row with its quantity, while the legacy single `custody`
    // collapses to the first row's custodian (no leaked `quantity`).
    const result = shapeMobileAssetResponse({
      ...baseAsset,
      type: "QUANTITY_TRACKED",
      quantity: 10,
      unitOfMeasure: "pcs",
      custody: [
        custodyRow("tm-1", "Alice", 3, { userId: "user-alice" }),
        custodyRow("tm-2", "Bob", 2),
      ],
    });

    // Many-aware list keeps both entries with their quantities. Operator-only
    // rows are fully releasable; `userId` passes through for own-row checks.
    expect(result.custodyList).toEqual([
      {
        custodian: { id: "tm-1", name: "Alice", userId: "user-alice" },
        quantity: 3,
        releasableQuantity: 3,
      },
      {
        custodian: { id: "tm-2", name: "Bob", userId: null },
        quantity: 2,
        releasableQuantity: 2,
      },
    ]);

    // Legacy single custody = first row's custodian only (quantity stripped).
    expect(result.custody).toEqual({
      custodian: { id: "tm-1", name: "Alice", userId: "user-alice" },
    });

    // Quantity scalar passes through.
    expect(result.quantity).toBe(10);
    expect(result.type).toBe("QUANTITY_TRACKED");
  });

  it("sums kit-allocated rows into quantity but excludes them from releasableQuantity", () => {
    // A holder with an operator row (3) AND a kit-allocated row (2) shows once
    // with quantity 5, but only the operator portion is releasable via the
    // release-quantity endpoint — kit-allocated units are released by
    // releasing the kit's custody.
    const result = shapeMobileAssetResponse({
      ...baseAsset,
      type: "QUANTITY_TRACKED",
      quantity: 10,
      custody: [
        custodyRow("tm-1", "Alice", 3, { userId: "user-alice" }),
        custodyRow("tm-1", "Alice", 2, {
          userId: "user-alice",
          kitCustodyId: "kc-1",
        }),
      ],
    });

    expect(result.custodyList).toEqual([
      {
        custodian: { id: "tm-1", name: "Alice", userId: "user-alice" },
        quantity: 5,
        releasableQuantity: 3,
      },
    ]);
  });
});
