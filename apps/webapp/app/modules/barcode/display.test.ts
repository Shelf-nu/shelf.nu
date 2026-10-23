import { BarcodeType } from "@prisma/client";
import { describe, it, expect } from "vitest";
import {
  resolveDisplayCode,
  describeCodeFallback,
  serializeDisplayCode,
  type AssetForCodeResolution,
  type OrganizationForCodeResolution,
  type ResolvedDisplayCode,
  ASSET_CODE_RESOLUTION_SELECT,
  QR_CODES_ORDER_BY,
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
      entityKind: "asset",
    });

    expect(result).toEqual({
      value: "qr-abc",
      type: "QR_ID",
      isFallback: false,
      workspacePreference: "QR_ID",
      entityKind: "asset",
    });
  });

  it("returns empty string when asset has no QR row in the included relation", () => {
    // Edge: loader didn't include qrCodes, or asset somehow has none.
    // Caller (the badge) treats empty string as "render nothing."
    const result = resolveDisplayCode({
      entity: asset({ qrCodes: [] }),
      organization: org({ qrIdDisplayPreference: "QR_ID" }),
      entityKind: "asset",
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
      entityKind: "asset",
    });

    expect(result).toEqual({
      value: "SAM-0042",
      type: "SAM_ID",
      isFallback: false,
      workspacePreference: "SAM_ID",
      entityKind: "asset",
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
      entityKind: "asset",
    });

    expect(result).toEqual({
      value: "qr-fallback",
      type: "QR_ID",
      isFallback: true,
      workspacePreference: "SAM_ID",
      entityKind: "asset",
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
      entityKind: "asset",
    });

    expect(result).toEqual({
      value: "ABC-123",
      type: "Code128",
      isFallback: false,
      workspacePreference: "Code128",
      entityKind: "asset",
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
      entityKind: "asset",
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
      entityKind: "asset",
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
      entityKind: "asset",
    });

    expect(result).toEqual({
      value: "qr-id-x",
      type: "QR_ID",
      isFallback: true,
      workspacePreference: "Code128",
      entityKind: "asset",
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
      entityKind: "asset",
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
      entityKind: "asset",
    });

    expect(result).toEqual({
      value: "TARGET",
      type: "Code39",
      isFallback: false,
      workspacePreference: "Code128",
      entityKind: "asset",
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
      entityKind: "asset",
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
      entityKind: "asset",
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
      entityKind: "asset",
    });

    expect(result).toEqual({
      value: "qr-noaddon",
      type: "QR_ID",
      isFallback: false,
      workspacePreference: "QR_ID",
      entityKind: "asset",
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
      entityKind: "asset",
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
      entityKind: "asset",
    });

    expect(result).toEqual({
      value: "qr-only",
      type: "QR_ID",
      isFallback: true,
      workspacePreference: "Code128",
      entityKind: "asset",
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
      entityKind: "asset",
    });

    expect(result).toEqual({
      value: "qr-after-downgrade",
      type: "QR_ID",
      isFallback: true,
      workspacePreference: "Code128",
      entityKind: "asset",
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
      entityKind: "asset",
    });

    expect(result).toEqual({
      value: "qr-after-downgrade",
      type: "QR_ID",
      isFallback: true,
      workspacePreference: "Code128",
      entityKind: "asset",
    });
  });

  it("carries entityKind through so callers can word help text honestly", () => {
    // why: the resolver picks the same code for a kit as for an asset — this
    // field never changes WHICH code wins. It exists so the badge can avoid
    // telling a kit to add a SAM ID, which kits cannot have.
    const result = resolveDisplayCode({
      entity: { qrCodes: [{ id: "kit-qr" }] },
      organization: {
        qrIdDisplayPreference: "SAM_ID",
        barcodesEnabled: false,
      },
      entityKind: "kit",
    });

    expect(result.entityKind).toBe("kit");
    expect(result.value).toBe("kit-qr");
    expect(result.isFallback).toBe(true);
  });

  it("refuses to resolve without an entityKind", () => {
    // The failure this guards is invisible at runtime: an entity resolved as
    // the wrong kind still renders, still shows the RIGHT code, and only the
    // fallback advice becomes impossible to follow ("add a SAM ID" to a kit).
    // Nothing observable is wrong, so no ordinary assertion can catch it and
    // the compiler has to be the guard.
    //
    // The directive below IS that guard: make `entityKind` optional again and
    // it stops suppressing anything, so `tsc` fails the build on an unused
    // directive. Deleting this case removes the only enforcement there is.
    // (Keep any mention of the directive off the start of a comment line —
    // TypeScript reads one there as real, wherever it appears.)
    // @ts-expect-error - entityKind is deliberately required
    const result = resolveDisplayCode({
      entity: { qrCodes: [{ id: "qr" }] },
      organization: { qrIdDisplayPreference: "QR_ID", barcodesEnabled: false },
    });

    // Still resolves at runtime — which is exactly why the type must object.
    expect(result.value).toBe("qr");
  });
});

describe("ASSET_CODE_RESOLUTION_SELECT", () => {
  it("orders the QR relation, so the one QR it keeps is the same on every read", () => {
    // why: the fragment keeps a single QR and `Qr.assetId` is not unique.
    // Without the order, which QR survives `take: 1` is up to the database.
    expect(ASSET_CODE_RESOLUTION_SELECT.qrCodes).toEqual({
      take: 1,
      orderBy: QR_CODES_ORDER_BY,
      select: { id: true },
    });
  });
});

describe("describeCodeFallback", () => {
  it("has nothing to explain when the preferred code is the one shown", () => {
    expect(
      describeCodeFallback({
        type: "Code128",
        isFallback: false,
        workspacePreference: "Code128",
        entityKind: "asset",
      })
    ).toBeNull();
  });

  it("names the preference an asset is missing, not the code shown in its place", () => {
    expect(
      describeCodeFallback({
        type: "QR_ID",
        isFallback: true,
        workspacePreference: "Code128",
        entityKind: "asset",
      })
    ).toEqual({
      text: "Your workspace prefers Code 128 but this item has no Code 128.",
      fixable: true,
    });
  });

  it("tells a kit on a SAM ID workspace that kits have none, and offers no fix", () => {
    // why: `Kit` has no `sequentialId` column and no UI to set one, so the
    // generic "this item has no SAM ID" would imply a fix nobody can make.
    expect(
      describeCodeFallback({
        type: "QR_ID",
        isFallback: true,
        workspacePreference: "SAM_ID",
        entityKind: "kit",
      })
    ).toEqual({
      text: "Your workspace prefers SAM ID, which kits do not have. Showing the QR Code ID instead.",
      fixable: false,
    });
  });

  it("words a kit's missing barcode the same as an asset's", () => {
    // why: kits do carry barcodes, so only SAM ID earns the kit wording.
    expect(
      describeCodeFallback({
        type: "QR_ID",
        isFallback: true,
        workspacePreference: "Code128",
        entityKind: "kit",
      })
    ).toEqual({
      text: "Your workspace prefers Code 128 but this item has no Code 128.",
      fixable: true,
    });
  });
});

describe("serializeDisplayCode", () => {
  /** A resolved code with overrides; defaults to an honoured Code 128. */
  function resolved(
    partial: Partial<ResolvedDisplayCode> = {}
  ): ResolvedDisplayCode {
    return {
      value: "CODE-000128",
      type: "Code128",
      isFallback: false,
      workspacePreference: "Code128",
      entityKind: "asset",
      ...partial,
    };
  }

  it("labels the code that is shown and carries no note when nothing fell back", () => {
    expect(serializeDisplayCode(resolved())).toEqual({
      value: "CODE-000128",
      label: "Code 128",
      type: "Code128",
      isFallback: false,
      fallbackNote: null,
    });
  });

  it("keeps the label on the code shown and explains the fallback separately", () => {
    // why: a client that printed `label` as the missing preference would tell
    // the reader the workspace shows "QR Code ID". The preference is named
    // only in `fallbackNote`.
    expect(
      serializeDisplayCode(
        resolved({ value: "qr-1", type: "QR_ID", isFallback: true })
      )
    ).toEqual({
      value: "qr-1",
      label: "QR Code ID",
      type: "QR_ID",
      isFallback: true,
      fallbackNote:
        "Your workspace prefers Code 128 but this item has no Code 128.",
    });
  });

  it("sends nothing when the entity has no code to show", () => {
    expect(
      serializeDisplayCode(
        resolved({ value: "", type: "QR_ID", isFallback: true })
      )
    ).toBeNull();
  });
});
