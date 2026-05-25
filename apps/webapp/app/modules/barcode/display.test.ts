import { BarcodeType } from "@prisma/client";
import { describe, it, expect } from "vitest";
import {
  resolveDisplayCode,
  type AssetForCodeResolution,
  type OrganizationForCodeResolution,
} from "./display";

// @vitest-environment node

/**
 * Resolver tests — every branch.
 *
 * Test data uses minimal valid shapes. The resolver is pure (no mocks needed).
 */

/** Build an asset shape with sensible defaults; spread overrides last. */
function asset(
  partial: Partial<AssetForCodeResolution> = {}
): AssetForCodeResolution {
  return {
    sequentialId: null,
    qrCodes: [{ id: "qr-fallback-id" }],
    barcodes: [],
    preferredBarcodeId: null,
    ...partial,
  };
}

/** Build an organization shape with sensible defaults. */
function org(
  partial: Partial<OrganizationForCodeResolution> = {}
): OrganizationForCodeResolution {
  return {
    qrIdDisplayPreference: "QR_ID",
    barcodesEnabled: true,
    ...partial,
  };
}

describe("resolveDisplayCode — workspace preference QR_ID", () => {
  it("returns the QR id with no fallback flag", () => {
    const result = resolveDisplayCode({
      entity: asset({ qrCodes: [{ id: "qr-abc" }] }),
      organization: org({ qrIdDisplayPreference: "QR_ID" }),
    });

    expect(result).toEqual({
      value: "qr-abc",
      type: "QR_ID",
      isFallback: false,
      workspacePreference: "QR_ID",
    });
  });

  it("returns empty string when asset has no QR row in the included relation", () => {
    // Edge: loader didn't include qrCodes, or asset somehow has none.
    // Caller (the badge) treats empty string as "render nothing."
    const result = resolveDisplayCode({
      entity: asset({ qrCodes: [] }),
      organization: org({ qrIdDisplayPreference: "QR_ID" }),
    });

    expect(result.value).toBe("");
    expect(result.type).toBe("QR_ID");
  });
});

describe("resolveDisplayCode — workspace preference SAM_ID", () => {
  it("returns the sequentialId when present", () => {
    const result = resolveDisplayCode({
      entity: asset({ sequentialId: "SAM-0042" }),
      organization: org({ qrIdDisplayPreference: "SAM_ID" }),
    });

    expect(result).toEqual({
      value: "SAM-0042",
      type: "SAM_ID",
      isFallback: false,
      workspacePreference: "SAM_ID",
    });
  });

  it("falls back to QR id with isFallback=true when sequentialId is missing", () => {
    // An asset created before the SAM migration may have null sequentialId.
    const result = resolveDisplayCode({
      entity: asset({
        sequentialId: null,
        qrCodes: [{ id: "qr-fallback" }],
      }),
      organization: org({ qrIdDisplayPreference: "SAM_ID" }),
    });

    expect(result).toEqual({
      value: "qr-fallback",
      type: "QR_ID",
      isFallback: true,
      workspacePreference: "SAM_ID",
    });
  });
});

describe("resolveDisplayCode — workspace preference is a BarcodeType", () => {
  it("returns the matching barcode when one exists", () => {
    const result = resolveDisplayCode({
      entity: asset({
        barcodes: [{ id: "bc-1", type: BarcodeType.Code128, value: "ABC-123" }],
      }),
      organization: org({ qrIdDisplayPreference: "Code128" }),
    });

    expect(result).toEqual({
      value: "ABC-123",
      type: "Code128",
      isFallback: false,
      workspacePreference: "Code128",
    });
  });

  it("returns deterministic first when asset has multiple of the preferred type", () => {
    // Lexicographic id ordering — predictable across page loads.
    const result = resolveDisplayCode({
      entity: asset({
        barcodes: [
          { id: "bc-zz", type: BarcodeType.Code128, value: "Z-LAST" },
          { id: "bc-aa", type: BarcodeType.Code128, value: "A-FIRST" },
          { id: "bc-mm", type: BarcodeType.Code128, value: "M-MIDDLE" },
        ],
      }),
      organization: org({ qrIdDisplayPreference: "Code128" }),
    });

    expect(result.value).toBe("A-FIRST");
    expect(result.isFallback).toBe(false);
  });

  it("ignores barcodes of other types when filtering for preferred", () => {
    const result = resolveDisplayCode({
      entity: asset({
        barcodes: [
          { id: "bc-1", type: BarcodeType.Code39, value: "C39-1" },
          { id: "bc-2", type: BarcodeType.Code128, value: "C128-1" },
          { id: "bc-3", type: BarcodeType.DataMatrix, value: "DM-1" },
        ],
      }),
      organization: org({ qrIdDisplayPreference: "Code128" }),
    });

    expect(result.value).toBe("C128-1");
    expect(result.type).toBe("Code128");
  });

  it("falls back to QR with isFallback=true when no matching barcode", () => {
    const result = resolveDisplayCode({
      entity: asset({
        qrCodes: [{ id: "qr-id-x" }],
        barcodes: [{ id: "bc-1", type: BarcodeType.Code39, value: "C39-1" }],
      }),
      organization: org({ qrIdDisplayPreference: "Code128" }),
    });

    expect(result).toEqual({
      value: "qr-id-x",
      type: "QR_ID",
      isFallback: true,
      workspacePreference: "Code128",
    });
  });

  // Smoke-test the remaining BarcodeType enum values via default-branch coverage
  it.each([
    BarcodeType.Code39,
    BarcodeType.DataMatrix,
    BarcodeType.ExternalQR,
    BarcodeType.EAN13,
  ])("resolves correctly when preference is %s", (preferred) => {
    const result = resolveDisplayCode({
      entity: asset({
        barcodes: [{ id: "bc-x", type: preferred, value: `${preferred}-val` }],
      }),
      organization: org({ qrIdDisplayPreference: preferred }),
    });

    expect(result.value).toBe(`${preferred}-val`);
    expect(result.type).toBe(preferred);
    expect(result.isFallback).toBe(false);
  });
});

describe("resolveDisplayCode — per-asset preferredBarcodeId override", () => {
  it("returns the overridden barcode when set and resolvable", () => {
    const result = resolveDisplayCode({
      entity: asset({
        preferredBarcodeId: "bc-target",
        barcodes: [
          { id: "bc-other", type: BarcodeType.Code128, value: "OTHER" },
          { id: "bc-target", type: BarcodeType.Code39, value: "TARGET" },
        ],
      }),
      // Workspace prefers Code128, but the override forces Code39 for this asset
      organization: org({ qrIdDisplayPreference: "Code128" }),
    });

    expect(result).toEqual({
      value: "TARGET",
      type: "Code39",
      isFallback: false,
      workspacePreference: "Code128",
    });
  });

  it("falls through to workspace preference when override points at a stale id", () => {
    // Defensive: onDelete: SetNull on the FK normally prevents this, but if
    // the included `barcodes` relation hasn't refreshed, we should not crash.
    const result = resolveDisplayCode({
      entity: asset({
        preferredBarcodeId: "bc-deleted",
        qrCodes: [{ id: "qr-x" }],
        barcodes: [
          { id: "bc-present", type: BarcodeType.Code128, value: "PRESENT" },
        ],
      }),
      organization: org({ qrIdDisplayPreference: "Code128" }),
    });

    // Falls through to workspace pref → picks bc-present
    expect(result.value).toBe("PRESENT");
    expect(result.type).toBe("Code128");
    expect(result.isFallback).toBe(false);
  });

  it("override is honored even when workspace pref is QR_ID", () => {
    const result = resolveDisplayCode({
      entity: asset({
        preferredBarcodeId: "bc-1",
        barcodes: [
          {
            id: "bc-1",
            type: BarcodeType.ExternalQR,
            value: "https://x.example",
          },
        ],
      }),
      organization: org({ qrIdDisplayPreference: "QR_ID" }),
    });

    expect(result.value).toBe("https://x.example");
    expect(result.type).toBe("ExternalQR");
    expect(result.isFallback).toBe(false);
  });
});

describe("resolveDisplayCode — non-addon organizations", () => {
  it("respects QR_ID preference (existing behavior, no barcodes feature needed)", () => {
    const result = resolveDisplayCode({
      entity: asset({ qrCodes: [{ id: "qr-noaddon" }] }),
      organization: org({
        barcodesEnabled: false,
        qrIdDisplayPreference: "QR_ID",
      }),
    });

    expect(result).toEqual({
      value: "qr-noaddon",
      type: "QR_ID",
      isFallback: false,
      workspacePreference: "QR_ID",
    });
  });

  it("respects SAM_ID preference even without the barcodes add-on", () => {
    // SAM is independent of barcodes. Non-addon customers can use SAM.
    const result = resolveDisplayCode({
      entity: asset({ sequentialId: "SAM-0001" }),
      organization: org({
        barcodesEnabled: false,
        qrIdDisplayPreference: "SAM_ID",
      }),
    });

    expect(result.value).toBe("SAM-0001");
    expect(result.type).toBe("SAM_ID");
  });

  it("gracefully falls back to QR if pref is a BarcodeType (data drift)", () => {
    // The UI prevents non-addon orgs from setting this, but DB drift is
    // possible. Resolver must not crash.
    const result = resolveDisplayCode({
      entity: asset({
        qrCodes: [{ id: "qr-only" }],
        barcodes: [], // No barcodes table data because no addon
      }),
      organization: org({
        barcodesEnabled: false,
        qrIdDisplayPreference: "Code128",
      }),
    });

    expect(result).toEqual({
      value: "qr-only",
      type: "QR_ID",
      isFallback: true,
      workspacePreference: "Code128",
    });
  });

  it("does not honor preferredBarcodeId when the org has lost the addon", () => {
    // The override branch must also respect the addon gate — otherwise an
    // org that drops the alternative-barcodes addon would still see Code128
    // values via per-asset preferredBarcodeId pointing at the surviving
    // Barcode row. Fall back to QR with isFallback=true.
    const result = resolveDisplayCode({
      entity: asset({
        preferredBarcodeId: "bc-stale-override",
        qrCodes: [{ id: "qr-after-downgrade" }],
        barcodes: [
          {
            id: "bc-stale-override",
            type: BarcodeType.Code128,
            value: "SHOULD-NOT-SHOW",
          },
        ],
      }),
      organization: org({
        barcodesEnabled: false,
        qrIdDisplayPreference: "Code128",
      }),
    });

    expect(result).toEqual({
      value: "qr-after-downgrade",
      type: "QR_ID",
      isFallback: true,
      workspacePreference: "Code128",
    });
  });

  it("does not surface stale barcodes when the org has lost the addon", () => {
    // Harder data-drift case: org HAD the addon, created Code128 barcodes,
    // set Code128 as workspace pref, then dropped the addon. The barcodes
    // still exist in the DB, but should NOT be rendered as the chip — fall
    // back to QR with isFallback=true so the outlined chip flags the
    // entitlement gap.
    const result = resolveDisplayCode({
      entity: asset({
        qrCodes: [{ id: "qr-after-downgrade" }],
        barcodes: [
          { id: "bc-stale", type: BarcodeType.Code128, value: "OLD-VAL" },
        ],
      }),
      organization: org({
        barcodesEnabled: false,
        qrIdDisplayPreference: "Code128",
      }),
    });

    expect(result).toEqual({
      value: "qr-after-downgrade",
      type: "QR_ID",
      isFallback: true,
      workspacePreference: "Code128",
    });
  });
});
