/**
 * Bulk QR Label Export — loader
 *
 * Returns the data the asset-index QR export needs to build vector labels
 * client-side (PDF sheet + SVG/labels.csv zip). Replaces the old raster path:
 * no per-asset `sharp` QR encoding here — we return each asset's existing QR id
 * (every asset has one per the `createAsset` contract) and let the browser draw
 * the vector QR from it.
 *
 * Honors three existing Shelf concepts (the guardrails):
 *  - **Resolver:** the printed identifier text comes from `resolveDisplayCode`,
 *    the same source of truth as list views and `<AssetCodeBadge>`.
 *  - **Branding is tier-gated revenue:** "Powered by shelf.nu" is re-resolved
 *    server-side against the tier — a free workspace can't strip it via export.
 *  - **Org-scoped:** all assets are filtered by `organizationId` (no cross-org IDOR).
 *
 * @see {@link file://./../../modules/qr/label.ts}
 * @see {@link file://./../../modules/qr/labels-csv.server.ts}
 * @see {@link file://./../../components/assets/bulk-download-qr-dialog.tsx}
 */
import { data, type LoaderFunctionArgs } from "react-router";
import { db } from "~/database/db.server";
import { resolveAssetIdsForBulkOperation } from "~/modules/asset/bulk-operations-helper.server";
import { ASSET_LOCATIONS_INCLUDE } from "~/modules/asset/fields";
import { lastAuditDateAccessFor } from "~/modules/asset/last-audit-date-access.server";
import { getPrimaryLocation } from "~/modules/asset/utils";
import { getAssetIndexSettings } from "~/modules/asset-index-settings/service.server";
import {
  ASSET_CODE_RESOLUTION_SELECT,
  resolveDisplayCode,
} from "~/modules/barcode/display";
import { buildLabelsCsv } from "~/modules/qr/labels-csv.server";
import { getQrBaseUrl } from "~/modules/qr/qr-url.server";
import { scopeCustodianFilterIds } from "~/modules/team-member/service.server";
import { getOrganizationTierLimit } from "~/modules/tier/service.server";
import { getClientHint } from "~/utils/client-hints";
import { resolveUserFormatPrefsById } from "~/utils/date-format.server";
import { makeShelfError, ShelfError } from "~/utils/error";
import { payload, error } from "~/utils/http.server";
import { ALL_SELECTED_KEY } from "~/utils/list";
import { Logger } from "~/utils/logger";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { requirePermission } from "~/utils/roles.server";
import {
  assertUserCanExportAssets,
  canHideShelfBranding,
} from "~/utils/subscription.server";

/**
 * Safety bound on a single export. The old 100-item cap existed to protect the
 * browser from rasterizing that many DOM nodes and the server from that many
 * `sharp` encodes — both deleted. This bound only guards against an accidental
 * multi-thousand-asset export OOMing the browser zip; it is generous, not the
 * old constraint.
 */
export const MAX_BULK_QR_EXPORT = 1500;

export type BulkQrDownloadLoaderData = {
  assets: Array<{
    /** Asset id — not printed on the label. */
    id: string;
    /** Asset name — shown on the label, used for the filename. */
    title: string;
    /** The Shelf QR id the scannable graphic encodes. */
    qrId: string;
    /** Resolver-driven identifier text printed under the QR. */
    idText: string;
  }>;
  /** Env-derived QR base url; the client builds `${qrBaseUrl}/${qrId}`. */
  qrBaseUrl: string;
  /** Effective branding flag AFTER the tier gate (never a raw org toggle). */
  showBranding: boolean;
  /**
   * How many selected assets were excluded because they have no QR code (data
   * drift). Surfaced so the UI can tell the user "N skipped" instead of silently
   * dropping them — a silent drop is discovered too late, in the field.
   */
  skippedAssetCount: number;
  /**
   * `labels.csv` for the zip: one row per exported asset, same order as
   * `assets`, for third-party label software (see `buildLabelsCsv`).
   */
  labelsCsv: string;
};

/**
 * Finds the selected (or all-filtered) assets in the current organization and
 * returns the data needed to generate QR labels, after permission + tier checks.
 */
export async function loader({ context, request }: LoaderFunctionArgs) {
  const authSession = context.getSession();
  const { userId } = authSession;

  try {
    const {
      organizationId,
      organizations,
      currentOrganization,
      access,
      canUseBarcodes,
      role,
    } = await requirePermission({
      userId,
      request,
      entity: PermissionEntity.qr,
      action: PermissionAction.read,
    });

    // Paid feature: print-ready QR label export is gated behind the same
    // entitlement as the CSV asset export. Enforced server-side so a free user
    // can't reach the data even by calling the API directly (the UI also shows
    // an upgrade prompt instead of the export — see bulk-download-qr-dialog).
    await assertUserCanExportAssets({ organizationId, organizations });

    const searchParams = new URL(request.url).searchParams;
    const assetIds = searchParams.getAll("assetIds");

    if (assetIds.length === 0) {
      throw new ShelfError({
        cause: null,
        status: 400,
        message: "No asset id provided.",
        shouldBeCaptured: false,
        label: "Assets",
      });
    }

    /**
     * "Select all" resolves through the bulk helper, which reads the member's
     * saved index mode: in advanced mode the URL carries filter syntax such as
     * `status=is:AVAILABLE`, which only the advanced filter parser understands.
     */
    let resolvedIds = assetIds;
    if (assetIds.includes(ALL_SELECTED_KEY)) {
      const savedSettings = await getAssetIndexSettings({
        userId,
        organizationId,
        canUseBarcodes,
        role,
      });
      /**
       * Advanced filtering is a per-role capability, and the saved mode can
       * outlive it (a demoted member keeps ADVANCED until they next open
       * /assets). Advanced search also matches custodian names, so a role
       * without the capability always resolves in simple mode.
       */
      const settings = access.policy.ui.advancedAssetIndex
        ? savedSettings
        : { ...savedSettings, mode: "SIMPLE" as const };
      // Date filters truncate the day in the member's own time zone.
      const { timeZone } = await resolveUserFormatPrefsById(
        userId,
        getClientHint(request)
      );

      resolvedIds = await resolveAssetIdsForBulkOperation({
        assetIds,
        organizationId,
        currentSearchParams: searchParams.toString(),
        settings,
        timeZone,
        /**
         * `qr: read` is held by BASE and SELF_SERVICE, so this endpoint is
         * reachable by roles that may not see other people's custody. An
         * unscoped custodian filter would list exactly which assets a named
         * colleague holds, ignoring `baseUserCanSeeCustody`. A member who sees
         * all custody passes the "all" sentinel: the helper refuses an
         * advanced `custody` filter for anything else.
         */
        allowedTeamMemberIds: access.custody.seeAll
          ? "all"
          : await scopeCustodianFilterIds({
              teamMemberIds: searchParams.getAll("teamMember"),
              canSeeAllCustody: false,
              userId,
              organizationId,
            }),
        // The Archived / All views are for members who may see archived
        // assets (`assets.seeArchived`, issue #382); anyone else downloads
        // the codes of active assets, whatever the URL says.
        honorArchivedView: access.policy.assets.seeArchived,
        lastAuditDateAccess: lastAuditDateAccessFor(
          access,
          currentOrganization
        ),
      });
    }

    // Checked on the resolved ids, before any asset rows are loaded, so a huge
    // select-all doesn't read the whole inventory just to be rejected.
    if (resolvedIds.length > MAX_BULK_QR_EXPORT) {
      throw new ShelfError({
        cause: null,
        label: "Assets",
        status: 400,
        shouldBeCaptured: false,
        message: `QR export is limited to ${MAX_BULK_QR_EXPORT} assets at a time. Please narrow your selection.`,
      });
    }

    const rows = await db.asset.findMany({
      // eslint-disable-next-line local-rules/require-archived-at-check-on-asset-queries -- why: ids are already resolved; select-all honours the archived view above, and an explicit selection may print an archived asset's label
      where: { id: { in: resolvedIds }, organizationId },
      select: {
        id: true,
        title: true,
        ...ASSET_CODE_RESOLUTION_SELECT,
        // Only for labels.csv; not part of the per-asset payload.
        category: { select: { name: true } },
        // The primary location, same ordering every list view reads index 0 of.
        assetLocations: {
          orderBy: ASSET_LOCATIONS_INCLUDE.orderBy,
          take: 1,
          select: { location: { select: { name: true } } },
        },
      },
    });

    /* Branding is revenue: re-resolve against the tier, never trust the org toggle alone. */
    const tierLimit = await getOrganizationTierLimit({
      organizationId,
      organizations,
    });
    const showBranding = canHideShelfBranding(tierLimit)
      ? currentOrganization.showShelfBranding
      : true;

    const resolverOrg = {
      qrIdDisplayPreference: currentOrganization.qrIdDisplayPreference,
      barcodesEnabled: currentOrganization.barcodesEnabled ?? false,
    };

    const assets: BulkQrDownloadLoaderData["assets"] = [];
    const labelRows: Parameters<typeof buildLabelsCsv>[0] = [];

    for (const asset of rows) {
      const qrId = asset.qrCodes[0]?.id;
      if (!qrId) {
        // Data-drift anomaly: every asset should have a QR (createAsset). Skip
        // gracefully rather than ship a label that can't scan, and surface it.
        Logger.warn(
          new ShelfError({
            cause: null,
            message: `Asset ${asset.id} has no QR code; excluded from QR export.`,
            additionalData: { assetId: asset.id, organizationId },
            label: "Assets",
            shouldBeCaptured: false,
          })
        );
        continue;
      }
      const resolved = resolveDisplayCode({
        entity: asset,
        organization: resolverOrg,
        entityKind: "asset",
      });
      assets.push({
        id: asset.id,
        title: asset.title,
        qrId,
        idText: resolved.value || qrId,
      });
      labelRows.push({
        title: asset.title,
        sequentialId: asset.sequentialId,
        qrId,
        category: asset.category,
        location: getPrimaryLocation({ assetLocations: asset.assetLocations }),
      });
    }

    return data(
      payload({
        assets,
        qrBaseUrl: getQrBaseUrl(),
        showBranding,
        // rows without a QR code were skipped above.
        skippedAssetCount: rows.length - assets.length,
        labelsCsv: buildLabelsCsv(labelRows),
      })
    );
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    return data(error(reason), { status: reason.status });
  }
}
