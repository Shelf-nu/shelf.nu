/**
 * Bulk QR Label Export — loader
 *
 * Returns the data the asset-index QR export needs to build vector labels
 * client-side (PDF sheet + SVG/manifest zip). Replaces the old raster path:
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
 * @see {@link file://./../../components/assets/bulk-download-qr-dialog.tsx}
 */
import type { Prisma } from "@prisma/client";
import { data, type LoaderFunctionArgs } from "react-router";
import { db } from "~/database/db.server";
import { getAssetsWhereInput } from "~/modules/asset/utils.server";
import {
  ASSET_CODE_RESOLUTION_SELECT,
  resolveDisplayCode,
} from "~/modules/barcode/display";
import { getQrBaseUrl } from "~/modules/qr/utils.server";
import { getOrganizationTierLimit } from "~/modules/tier/service.server";
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
    /** Asset id — manifest only. */
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
};

/**
 * Finds the selected (or all-filtered) assets in the current organization and
 * returns the data needed to generate QR labels, after permission + tier checks.
 */
export async function loader({ context, request }: LoaderFunctionArgs) {
  const authSession = context.getSession();
  const { userId } = authSession;

  try {
    const { organizationId, organizations, currentOrganization } =
      await requirePermission({
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

    /* Select-all carries the magic key + current filters; otherwise explicit ids. */
    const where: Prisma.AssetWhereInput = assetIds.includes(ALL_SELECTED_KEY)
      ? getAssetsWhereInput({
          organizationId,
          currentSearchParams: searchParams.toString(),
        })
      : { id: { in: assetIds }, organizationId };

    const rows = await db.asset.findMany({
      where,
      select: { id: true, title: true, ...ASSET_CODE_RESOLUTION_SELECT },
      // Bound the work: never load more than the cap (+1 to still detect overflow),
      // so a huge select-all doesn't load the whole inventory just to be rejected.
      take: MAX_BULK_QR_EXPORT + 1,
    });

    if (rows.length > MAX_BULK_QR_EXPORT) {
      throw new ShelfError({
        cause: null,
        label: "Assets",
        shouldBeCaptured: false,
        message: `QR export is limited to ${MAX_BULK_QR_EXPORT} assets at a time. Please narrow your selection.`,
      });
    }

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

    const assets = rows
      .map((asset) => {
        const qrId = asset.qrCodes[0]?.id;
        if (!qrId) {
          // Data-drift anomaly: every asset should have a QR (createAsset). Skip
          // gracefully rather than ship a label that can't scan, and surface it.
          Logger.warn({
            message: `Asset ${asset.id} has no QR code; excluded from QR export.`,
            additionalData: { assetId: asset.id, organizationId },
          });
          return null;
        }
        const resolved = resolveDisplayCode({
          entity: asset,
          organization: resolverOrg,
        });
        return {
          id: asset.id,
          title: asset.title,
          qrId,
          idText: resolved.value || qrId,
        };
      })
      .filter((a): a is NonNullable<typeof a> => a !== null);

    return data(
      payload({
        assets,
        qrBaseUrl: getQrBaseUrl(),
        showBranding,
      })
    );
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    return data(error(reason), { status: reason.status });
  }
}
