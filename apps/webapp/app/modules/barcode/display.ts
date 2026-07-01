/**
 * Asset Display-Code Resolver
 *
 * Resolves which identifier should be displayed for an asset in list views and
 * printed labels. Single source of truth used by:
 * - All 7+ asset list-view surfaces (see `.claude/rules/asset-list-surfaces-consistency.md`)
 * - The `<AssetCodeBadge>` rendering primitive
 * - The label-printing path in `code-preview.tsx` and `bulk-download-qr-dialog.tsx`
 *
 * Pure function — no DB access, no side effects. Safe to call from server
 * (loaders, services) or client (components reading loader data).
 *
 * Resolution precedence:
 *   1. Per-asset override (`Asset.preferredBarcodeId`) — when set and the
 *      referenced barcode is still present on the asset, it wins outright.
 *   2. Workspace preference (`Organization.qrIdDisplayPreference`):
 *      - `QR_ID` → the asset's QR code id
 *      - `SAM_ID` → the asset's `sequentialId` (e.g., `SAM-0001`)
 *      - barcode type → the first Barcode of that type (deterministic by id)
 *   3. Fallback → the asset's QR code id, always present per the
 *      `createAsset` contract (every asset has exactly one active QR).
 *
 * @see {@link file://./../../../packages/database/prisma/schema.prisma} for
 *      the `QrIdDisplayPreference` enum and `Asset.preferredBarcodeId` field
 */

import type {
  Barcode,
  Organization,
  Prisma,
  Qr,
  QrIdDisplayPreference,
} from "@prisma/client";

/**
 * Prisma `select` fragment for the asset fields a list-view loader must
 * include to call `resolveDisplayCode`. Designed to be spread into a
 * larger select clause:
 *
 *   const assets = await db.asset.findMany({
 *     where: { organizationId },
 *     select: {
 *       id: true,
 *       title: true,
 *       ...ASSET_CODE_RESOLUTION_SELECT,
 *     },
 *   });
 *
 * Tight by design: only fields the resolver reads. `qrCodes: { take: 1 }`
 * leverages the schema invariant that every asset has exactly one active
 * QR; older orphaned QRs (`assetId = null`) are excluded by the relation.
 */
export const ASSET_CODE_RESOLUTION_SELECT = {
  sequentialId: true,
  preferredBarcodeId: true,
  qrCodes: { take: 1, select: { id: true } },
  barcodes: { select: { id: true, type: true, value: true } },
} as const satisfies Prisma.AssetSelect;

/**
 * The minimum entity shape required to resolve a display code.
 *
 * Designed to cover any code-bearing entity in Shelf — assets and kits
 * today, more if added later. All identifier-like fields are optional so
 * kits (which lack `sequentialId` and `preferredBarcodeId` in v1) and
 * partial loader selects both work without crashing:
 * - Missing `qrCodes` / `barcodes` → treated as empty arrays
 * - Missing `sequentialId` → SAM_ID preference falls back to QR
 * - Missing `preferredBarcodeId` → no per-entity override, workspace pref applies
 *
 * Named `EntityFor…` (not `AssetFor…`) so the resolver's kit support isn't
 * hidden behind misleading naming.
 */
export type EntityForCodeResolution = {
  sequentialId?: string | null;
  qrCodes?: Pick<Qr, "id">[];
  barcodes?: Pick<Barcode, "id" | "type" | "value">[];
  preferredBarcodeId?: string | null;
};

/**
 * Back-compat alias. New code should use `EntityForCodeResolution`.
 * @deprecated — use `EntityForCodeResolution` (kit-inclusive).
 */
export type AssetForCodeResolution = EntityForCodeResolution;

/** The minimum organization shape required. */
export type OrganizationForCodeResolution = Pick<
  Organization,
  "qrIdDisplayPreference" | "barcodesEnabled"
>;

/**
 * Human-readable label for any `QrIdDisplayPreference` value.
 * Single source of truth — referenced by the badge tooltip,
 * the per-asset override selector, and customer-facing copy.
 */
export function labelForPreference(pref: QrIdDisplayPreference): string {
  switch (pref) {
    case "QR_ID":
      return "QR Code ID";
    case "SAM_ID":
      return "SAM ID";
    case "Code128":
      return "Code 128";
    case "Code39":
      return "Code 39";
    case "DataMatrix":
      return "DataMatrix";
    case "ExternalQR":
      return "External QR";
    case "EAN13":
      return "EAN-13";
  }
}

/** The resolved code ready to render. */
export type ResolvedDisplayCode = {
  /** The string to display (the QR id, the SAM id, or a Barcode.value). */
  value: string;
  /** Which preference branch produced the value — drives icon choice. */
  type: QrIdDisplayPreference;
  /** True when the workspace-preferred type was unavailable and we fell back to QR. */
  isFallback: boolean;
  /**
   * What the workspace ASKED FOR — included so callers can craft good
   * help/tooltip copy when `isFallback` is true (so the badge can say
   * "workspace prefers Code 128 but this asset has none" instead of just
   * "fallback"). Always populated.
   */
  workspacePreference: QrIdDisplayPreference;
};

/**
 * Resolves the display code for one asset given its workspace's preference.
 *
 * @param input - The asset + organization slices needed to resolve
 * @returns A `ResolvedDisplayCode` ready to pass into `<AssetCodeBadge>`
 */
export function resolveDisplayCode({
  entity,
  organization,
}: {
  entity: EntityForCodeResolution;
  organization: OrganizationForCodeResolution;
}): ResolvedDisplayCode {
  // Defensive: if the loader didn't include these relations (e.g. older
  // call site, partial select, or a test fixture), treat them as empty.
  // Keeps the resolver pure and graceful — callers see an empty/fallback
  // value rather than a runtime crash.
  const qrCodes = entity.qrCodes ?? [];
  const barcodes = entity.barcodes ?? [];

  // Universal fallback: every code-bearing entity has at least one active
  // QR. If the QR relation isn't included in the query, value is "" —
  // caller surfaces graceful empty.
  const qrFallback = (isFallback: boolean): ResolvedDisplayCode => ({
    value: qrCodes[0]?.id ?? "",
    type: "QR_ID",
    isFallback,
    workspacePreference: organization.qrIdDisplayPreference,
  });

  // 1. Per-entity override wins when present and resolvable — but ONLY if
  // the org still has the alternative-barcodes add-on. Barcode rows are only
  // created with the add-on, and per-asset overrides reference them; if the
  // add-on has been revoked, the override (like the workspace pref) should
  // not surface stale barcode values. Falls through to the workspace branch
  // (which also short-circuits to QR for barcode types when !barcodesEnabled).
  if (entity.preferredBarcodeId && organization.barcodesEnabled) {
    const preferred = barcodes.find((b) => b.id === entity.preferredBarcodeId);
    if (preferred) {
      return {
        value: preferred.value,
        type: preferred.type,
        isFallback: false,
        workspacePreference: organization.qrIdDisplayPreference,
      };
    }
    // Stale FK — fall through to workspace preference.
  }

  // 2. Workspace preference. Non-addon orgs can still set QR_ID or SAM_ID
  // (these don't require the barcode add-on); barcode-type values would only
  // be set by an addon org (UI-gated), but if data corruption put one here we
  // gracefully fall through to QR via the default branch.
  switch (organization.qrIdDisplayPreference) {
    case "QR_ID":
      return qrFallback(false);

    case "SAM_ID":
      // SAM_ID is asset-only in v1 — kits don't have sequentialId. When the
      // entity doesn't have it, fall back to QR with isFallback=true so the
      // badge renders the outlined "this isn't your preferred type" variant.
      return entity.sequentialId
        ? {
            value: entity.sequentialId,
            type: "SAM_ID",
            isFallback: false,
            workspacePreference: organization.qrIdDisplayPreference,
          }
        : qrFallback(true);

    // All BarcodeType-derived values: Code128, Code39, DataMatrix, ExternalQR, EAN13
    default: {
      // Addon-entitlement gate: if the org has lost the alternative-barcodes
      // add-on but their workspace preference is still a barcode type (from
      // when they had it), do not surface those barcode values — fall back
      // to QR with isFallback=true so the outlined chip flags the entitlement
      // gap. The UI prevents non-addon orgs from saving these values, but
      // data drift (addon revoked after a previous selection) is possible.
      if (!organization.barcodesEnabled) {
        return qrFallback(true);
      }

      const pref = organization.qrIdDisplayPreference;
      // Deterministic ordering: pick the lexicographically smallest barcode id
      // when an entity has multiple of the preferred type and no per-entity override.
      const matching = barcodes
        .filter((b) => b.type === pref)
        .sort((a, b) => a.id.localeCompare(b.id));

      return matching[0]
        ? {
            value: matching[0].value,
            type: matching[0].type,
            isFallback: false,
            workspacePreference: organization.qrIdDisplayPreference,
          }
        : qrFallback(true);
    }
  }
}
