/**
 * Unit tests for the Phase 4e quantity formatting helpers.
 *
 * These guard the security-irrelevant-but-correctness-critical contract that
 * every note/event site relies on: a count is rendered ONLY for
 * QUANTITY_TRACKED assets with a positive pivot quantity, and INDIVIDUAL
 * phrasing is left untouched.
 *
 * @see {@link file://./asset-quantity.ts}
 */
import { AssetType } from "@prisma/client";

import {
  assetQtyMeta,
  formatUnitCount,
  sanitizeUnitOfMeasureLabel,
} from "./asset-quantity";
import { wrapAssetWithCountForNote } from "./markdoc-wrappers";

const qty = (unitOfMeasure?: string | null) => ({
  type: AssetType.QUANTITY_TRACKED,
  unitOfMeasure,
});
const individual = { type: AssetType.INDIVIDUAL, unitOfMeasure: null };

describe("formatUnitCount", () => {
  it("renders count + default 'units' label for a qty-tracked asset", () => {
    expect(formatUnitCount(qty(), 50)).toBe("50 units");
  });

  it("uses the asset's unitOfMeasure when present", () => {
    expect(formatUnitCount(qty("boxes"), 50)).toBe("50 boxes");
  });

  it("falls back to 'units' for a blank/whitespace unitOfMeasure", () => {
    expect(formatUnitCount(qty("   "), 7)).toBe("7 units");
    expect(formatUnitCount(qty(""), 7)).toBe("7 units");
  });

  it("strips Markdoc tag characters so labels can't inject custom tags into notes", () => {
    // why: even though residual `/` survives the strip, no `{%` remains, so
    // Markdoc can't parse this as a tag — verifying the injection vector is dead.
    expect(
      formatUnitCount(qty('{% link to="/login" text="Click" /%}'), 5)
    ).toBe('5 link to="/login" text="Click" /');
    expect(formatUnitCount(qty("{%}"), 5)).toBe("5 units");
  });

  it("returns null for INDIVIDUAL assets regardless of quantity", () => {
    expect(formatUnitCount(individual, 50)).toBeNull();
  });

  it("returns null for a missing or non-positive quantity", () => {
    expect(formatUnitCount(qty(), null)).toBeNull();
    expect(formatUnitCount(qty(), undefined)).toBeNull();
    expect(formatUnitCount(qty(), 0)).toBeNull();
    expect(formatUnitCount(qty(), -3)).toBeNull();
  });
});

describe("sanitizeUnitOfMeasureLabel", () => {
  it("returns the trimmed label when it contains no tag characters", () => {
    expect(sanitizeUnitOfMeasureLabel("  boxes  ")).toBe("boxes");
  });

  it("strips `{`, `%`, `}` so Markdoc tags can't survive into rendered notes", () => {
    expect(sanitizeUnitOfMeasureLabel("{% link /%}")).toBe("link /");
    expect(sanitizeUnitOfMeasureLabel("{%}")).toBe("");
  });

  it("returns '' for null/undefined input", () => {
    expect(sanitizeUnitOfMeasureLabel(null)).toBe("");
    expect(sanitizeUnitOfMeasureLabel(undefined)).toBe("");
  });
});

describe("assetQtyMeta", () => {
  it("returns { quantity } for a qty-tracked asset with a positive count", () => {
    expect(assetQtyMeta(qty(), 50)).toEqual({ quantity: 50 });
  });

  it("returns {} for INDIVIDUAL assets so event meta stays clean", () => {
    expect(assetQtyMeta(individual, 50)).toEqual({});
  });

  it("returns {} for a missing or non-positive quantity", () => {
    expect(assetQtyMeta(qty(), null)).toEqual({});
    expect(assetQtyMeta(qty(), 0)).toEqual({});
  });
});

describe("wrapAssetWithCountForNote", () => {
  const asset = {
    id: "asset-1",
    title: "Pens",
    type: AssetType.QUANTITY_TRACKED,
    unitOfMeasure: null,
  };

  it("prefixes the count before the asset link for qty-tracked assets", () => {
    expect(wrapAssetWithCountForNote(asset, 50)).toBe(
      '50 units of {% link to="/assets/asset-1" text="Pens" /%}'
    );
  });

  it("returns the bare asset link for INDIVIDUAL assets (unchanged phrasing)", () => {
    expect(
      wrapAssetWithCountForNote({ ...asset, type: AssetType.INDIVIDUAL }, 50)
    ).toBe('{% link to="/assets/asset-1" text="Pens" /%}');
  });

  it("returns the bare asset link when quantity is missing/zero", () => {
    expect(wrapAssetWithCountForNote(asset, null)).toBe(
      '{% link to="/assets/asset-1" text="Pens" /%}'
    );
  });
});
