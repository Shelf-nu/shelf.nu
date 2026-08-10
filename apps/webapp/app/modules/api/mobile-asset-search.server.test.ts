/**
 * Test suite for the mobile assets-list search clauses.
 *
 * Pins the parity contract: mobile search uses the SAME shared clause
 * builders as the web `getAssets` fetcher — same fields, same ID-shaped
 * fast path, same zero-row fallback intent. A drift back to a mobile-only
 * field list (the original title-only bug users read as "search is broken")
 * fails here. Pure module — no mocks needed.
 *
 * @see {@link file://./mobile-asset-search.server.ts}
 * @see {@link file://./../asset/search.server.ts}
 */
import {
  buildFullAssetSearchOr,
  buildNarrowAssetSearchOr,
} from "~/modules/asset/search.server";
import { buildMobileAssetSearchWhere } from "./mobile-asset-search.server";

// @vitest-environment node

describe("buildMobileAssetSearchWhere", () => {
  it("returns an empty primary and no fallback when there is nothing to search", () => {
    expect(buildMobileAssetSearchWhere("")).toEqual({
      primary: {},
      fallback: null,
    });
    expect(buildMobileAssetSearchWhere("  , ")).toEqual({
      primary: {},
      fallback: null,
    });
  });

  it("uses the web full clause verbatim for word searches, with no fallback", () => {
    const { primary, fallback } = buildMobileAssetSearchWhere("tripod");

    expect(primary).toEqual({ OR: buildFullAssetSearchOr(["tripod"]) });
    expect(fallback).toBeNull();
  });

  it("matches description, tags, category, location, custodians, codes and custom fields", () => {
    // The complaint class this module exists to prevent: a term that only
    // lives in a description or tag must be part of the clause.
    const serialized = JSON.stringify(buildMobileAssetSearchWhere("beamer"));
    for (const fieldPath of [
      '"description"',
      '"tags"',
      '"category"',
      '"assetLocations"',
      '"custody"',
      '"qrCodes"',
      '"barcodes"',
      '"customFields"',
    ]) {
      expect(serialized).toContain(fieldPath);
    }
  });

  it("takes the narrow fast path for ID-shaped searches and offers the full fallback", () => {
    const { primary, fallback } = buildMobileAssetSearchWhere("SAM-0001");

    expect(primary).toEqual({ OR: buildNarrowAssetSearchOr(["sam-0001"]) });
    expect(fallback).toEqual({ OR: buildFullAssetSearchOr(["sam-0001"]) });
  });

  it("goes straight to the full clause when any term is not ID-shaped", () => {
    const { primary, fallback } =
      buildMobileAssetSearchWhere("sam-0001,tripod");

    expect(primary).toEqual({
      OR: buildFullAssetSearchOr(["sam-0001", "tripod"]),
    });
    expect(fallback).toBeNull();
  });

  it("normalizes terms the same way as web search (lowercase, comma-split)", () => {
    expect(buildMobileAssetSearchWhere("  Tripod, Canon ")).toEqual({
      primary: { OR: buildFullAssetSearchOr(["tripod", "canon"]) },
      fallback: null,
    });
  });
});
