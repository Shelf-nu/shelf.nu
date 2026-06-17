/**
 * @file Tests for the shared qty-tracked + AssetModel CSV-row validator.
 *
 * Covers both exported functions:
 *  - `validateQtyTrackedFields()` — the shared validator used by both the
 *    create-from-content path and the update-from-content path. Asserts
 *    the per-field shape rules + the create-vs-update branching for
 *    INDIVIDUAL / QUANTITY_TRACKED.
 *  - `parseQtyTrackedUpdateRow()` — the update-path wrapper that adds
 *    the type-immutability silent-ignore, qty-tracked-only-cells-on-
 *    INDIVIDUAL silent-drop, and assetModel-on-QUANTITY_TRACKED warn.
 *
 * No database mocking is needed — both functions are pure.
 *
 * @see {@link file://./qty-validation.server.ts}
 */
import { AssetType, ConsumptionType } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { ShelfError } from "~/utils/error";
import {
  parseQtyTrackedUpdateRow,
  validateQtyTrackedFields,
  type QtyValidationMode,
} from "./qty-validation.server";

// ---------------------------------------------------------------------------
// validateQtyTrackedFields
// ---------------------------------------------------------------------------

describe("validateQtyTrackedFields", () => {
  const createMode: QtyValidationMode = { kind: "create" };
  const updateIndividualMode: QtyValidationMode = {
    kind: "update",
    existingType: AssetType.INDIVIDUAL,
  };
  const updateQtyMode: QtyValidationMode = {
    kind: "update",
    existingType: AssetType.QUANTITY_TRACKED,
  };

  const ctx = { rowLabel: 'asset "Drill #3"', additionalData: { key: "k1" } };

  describe("create mode", () => {
    it("returns parsed values for a QUANTITY_TRACKED row with all required cells", () => {
      const result = validateQtyTrackedFields(
        {
          type: "QUANTITY_TRACKED",
          quantity: "50",
          minQuantity: "5",
          unitOfMeasure: "boxes",
          consumptionType: "ONE_WAY",
        },
        createMode,
        ctx
      );

      expect(result).toEqual({
        type: AssetType.QUANTITY_TRACKED,
        quantity: 50,
        minQuantity: 5,
        unitOfMeasure: "boxes",
        consumptionType: ConsumptionType.ONE_WAY,
      });
    });

    it("INDIVIDUAL row with no qty-tracked cells returns mostly-undefined values", () => {
      const result = validateQtyTrackedFields(
        { type: "INDIVIDUAL" },
        createMode,
        ctx
      );

      expect(result).toEqual({
        type: AssetType.INDIVIDUAL,
        quantity: undefined,
        minQuantity: undefined,
        unitOfMeasure: undefined,
        consumptionType: undefined,
      });
    });

    it("defaults type to undefined (schema applies INDIVIDUAL) when the type cell is blank", () => {
      const result = validateQtyTrackedFields({ type: "" }, createMode, ctx);
      expect(result.type).toBeUndefined();
    });

    it("throws on a non-integer quantity", () => {
      expect(() =>
        validateQtyTrackedFields(
          {
            type: "QUANTITY_TRACKED",
            quantity: "3.5",
            consumptionType: "ONE_WAY",
          },
          createMode,
          ctx
        )
      ).toThrow(ShelfError);
    });

    it("throws on a negative quantity", () => {
      expect(() =>
        validateQtyTrackedFields(
          {
            type: "QUANTITY_TRACKED",
            quantity: "-1",
            consumptionType: "ONE_WAY",
          },
          createMode,
          ctx
        )
      ).toThrow(/non-negative/);
    });

    it("throws on a negative minQuantity", () => {
      expect(() =>
        validateQtyTrackedFields(
          {
            type: "QUANTITY_TRACKED",
            quantity: "10",
            minQuantity: "-2",
            consumptionType: "ONE_WAY",
          },
          createMode,
          ctx
        )
      ).toThrow(/min/i);
    });

    it("throws on an invalid consumptionType enum value", () => {
      expect(() =>
        validateQtyTrackedFields(
          {
            type: "QUANTITY_TRACKED",
            quantity: "10",
            consumptionType: "INVALID_TYPE",
          },
          createMode,
          ctx
        )
      ).toThrow(/consumptionType/);
    });

    it("throws when QUANTITY_TRACKED row is missing consumptionType", () => {
      expect(() =>
        validateQtyTrackedFields(
          { type: "QUANTITY_TRACKED", quantity: "10" },
          createMode,
          ctx
        )
      ).toThrow(/Consumption type is required/);
    });

    it("throws when QUANTITY_TRACKED row is missing quantity", () => {
      expect(() =>
        validateQtyTrackedFields(
          { type: "QUANTITY_TRACKED", consumptionType: "ONE_WAY" },
          createMode,
          ctx
        )
      ).toThrow(/Quantity is required/);
    });

    it("throws when QUANTITY_TRACKED row has zero quantity", () => {
      expect(() =>
        validateQtyTrackedFields(
          {
            type: "QUANTITY_TRACKED",
            quantity: "0",
            consumptionType: "ONE_WAY",
          },
          createMode,
          ctx
        )
      ).toThrow(/Quantity is required/);
    });

    it("strips Markdoc-style injection chars from unitOfMeasure", () => {
      const result = validateQtyTrackedFields(
        {
          type: "QUANTITY_TRACKED",
          quantity: "10",
          unitOfMeasure: "{% boxes %}",
          consumptionType: "TWO_WAY",
        },
        createMode,
        ctx
      );
      // sanitizeUnitOfMeasureLabel drops `{`, `%`, `}` and trims.
      expect(result.unitOfMeasure).toBe("boxes");
    });

    it("rejects INDIVIDUAL row with quantity > 1", () => {
      expect(() =>
        validateQtyTrackedFields(
          { type: "INDIVIDUAL", quantity: "5" },
          createMode,
          ctx
        )
      ).toThrow(/INDIVIDUAL/);
    });

    it("accepts UPPER/lower variations of consumptionType", () => {
      const result = validateQtyTrackedFields(
        {
          type: "QUANTITY_TRACKED",
          quantity: "10",
          consumptionType: "one_way",
        },
        createMode,
        ctx
      );
      expect(result.consumptionType).toBe(ConsumptionType.ONE_WAY);
    });

    it("throws on an unrecognised type value", () => {
      expect(() =>
        validateQtyTrackedFields({ type: "BUNDLE" }, createMode, ctx)
      ).toThrow(/Invalid type/);
    });
  });

  describe("update mode", () => {
    it("ignores the type cell on update (silently)", () => {
      const result = validateQtyTrackedFields(
        // QUANTITY_TRACKED cell on an existing INDIVIDUAL asset — no error
        { type: "QUANTITY_TRACKED" },
        updateIndividualMode,
        ctx
      );
      expect(result.type).toBeUndefined();
    });

    it("does not require quantity for QUANTITY_TRACKED on update", () => {
      // No quantity cell at all → still valid in update mode
      const result = validateQtyTrackedFields({}, updateQtyMode, ctx);
      expect(result.quantity).toBeUndefined();
    });

    it("rejects 0 quantity for QUANTITY_TRACKED on update", () => {
      expect(() =>
        validateQtyTrackedFields({ quantity: "0" }, updateQtyMode, ctx)
      ).toThrow(/Quantity is required/);
    });

    it("accepts a missing consumptionType for QUANTITY_TRACKED on update", () => {
      // The create path requires it; update treats it as optional.
      const result = validateQtyTrackedFields(
        { quantity: "10" },
        updateQtyMode,
        ctx
      );
      expect(result.consumptionType).toBeUndefined();
    });

    it("still validates malformed minQuantity on update", () => {
      expect(() =>
        validateQtyTrackedFields({ minQuantity: "-3" }, updateQtyMode, ctx)
      ).toThrow(/min/i);
    });
  });
});

// ---------------------------------------------------------------------------
// parseQtyTrackedUpdateRow
// ---------------------------------------------------------------------------

describe("parseQtyTrackedUpdateRow", () => {
  it("returns patches for a QUANTITY_TRACKED existing asset with valid cells", () => {
    const result = parseQtyTrackedUpdateRow(
      {
        quantity: "42",
        minQuantity: "5",
        unitOfMeasure: "boxes",
        consumptionType: "TWO_WAY",
      },
      { type: AssetType.QUANTITY_TRACKED },
      7
    );

    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
    expect(result.patch).toEqual({
      quantity: 42,
      minQuantity: 5,
      unitOfMeasure: "boxes",
      consumptionType: ConsumptionType.TWO_WAY,
      assetModelLookupKey: undefined,
    });
  });

  it("ignores divergent type cell (decision #1: type is immutable on update)", () => {
    const result = parseQtyTrackedUpdateRow(
      // Row says QUANTITY_TRACKED but existing asset is INDIVIDUAL — no error,
      // no warning. Type cell is dropped entirely.
      { type: "QUANTITY_TRACKED" },
      { type: AssetType.INDIVIDUAL },
      3
    );

    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
    expect(result.patch.quantity).toBeUndefined();
    expect(result.patch.minQuantity).toBeUndefined();
  });

  it("silently drops qty-tracked cells on an INDIVIDUAL existing asset (decision #2)", () => {
    const result = parseQtyTrackedUpdateRow(
      {
        quantity: "999",
        minQuantity: "10",
        unitOfMeasure: "tons",
        consumptionType: "ONE_WAY",
      },
      { type: AssetType.INDIVIDUAL },
      5
    );

    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
    // Patch is empty for the qty-tracked fields — they're dropped silently.
    expect(result.patch.quantity).toBeUndefined();
    expect(result.patch.minQuantity).toBeUndefined();
    expect(result.patch.unitOfMeasure).toBeUndefined();
    expect(result.patch.consumptionType).toBeUndefined();
  });

  it("drops assetModel on a QUANTITY_TRACKED existing asset (decision #3); warning is surfaced by the diff layer", () => {
    // The parser still drops the cell so it never reaches `updateAsset`.
    // The user-facing warning fires from `compareCoreField` in the diff
    // layer (see `import-update-diff.ts`'s "assetModel" case) and is
    // forwarded into `result.warnings` by `applyBulkUpdatesFromImport`'s
    // per-change loop. Emitting a warning here too would double-surface
    // the same dropped cell in the UI's yellow pill.
    const result = parseQtyTrackedUpdateRow(
      { assetModel: "Dell Latitude" },
      { type: AssetType.QUANTITY_TRACKED },
      14
    );

    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
    expect(result.patch.assetModelLookupKey).toBeUndefined();
  });

  it("forwards assetModel on an INDIVIDUAL row to the caller for batch resolution", () => {
    const result = parseQtyTrackedUpdateRow(
      { assetModel: "  Dell Latitude  " },
      { type: AssetType.INDIVIDUAL },
      2
    );

    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
    // Trimmed before forwarding.
    expect(result.patch.assetModelLookupKey).toBe("Dell Latitude");
  });

  it("returns a per-row error for an unambiguously-malformed cell (non-integer quantity)", () => {
    const result = parseQtyTrackedUpdateRow(
      { quantity: "not-a-number" },
      { type: AssetType.QUANTITY_TRACKED },
      9
    );

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].rowIndex).toBe(9);
    // Patch is empty when validation errored — caller treats this as
    // "skip the qty-tracked update for this row" not "kill the import".
    expect(result.patch).toEqual({});
  });

  it("returns a per-row error for invalid consumptionType enum", () => {
    const result = parseQtyTrackedUpdateRow(
      { consumptionType: "THREE_WAY" },
      { type: AssetType.QUANTITY_TRACKED },
      11
    );

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].rowIndex).toBe(11);
  });

  it("empty assetModel cell does not warn even on QUANTITY_TRACKED", () => {
    const result = parseQtyTrackedUpdateRow(
      { assetModel: "   " },
      { type: AssetType.QUANTITY_TRACKED },
      4
    );

    expect(result.warnings).toEqual([]);
    expect(result.patch.assetModelLookupKey).toBeUndefined();
  });
});
