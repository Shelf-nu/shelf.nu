/**
 * Mobile API route — kit detail.
 *
 * Serves full kit detail to the companion app's kit screen: status, custody,
 * description, image, category, location, QR code, summed total value, and the
 * contained assets. Org-scoped and gated by the mobile bearer auth +
 * `kit:read` permission, mirroring the web kit-detail loader. Failures are
 * caught and returned as `{ error }` responses, not thrown.
 *
 * @see {@link file://./assets.$assetId.ts} the asset twin of this route
 */
import { data, type LoaderFunctionArgs } from "react-router";
import { z } from "zod";
import { db } from "~/database/db.server";
import {
  requireMobileAuth,
  requireMobilePermission,
  requireOrganizationAccess,
} from "~/modules/api/mobile-auth.server";
import { getAssetTotalValue } from "~/utils/asset-value";
import { makeShelfError } from "~/utils/error";
import { getParams } from "~/utils/http.server";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";

/**
 * GET /api/mobile/kits/:kitId?orgId=xxx
 *
 * Returns full kit detail for the companion app's kit screen: status,
 * custody, description, image, and the contained assets (each tappable
 * through to the asset detail screen).
 *
 * @param args - React Router loader args.
 * @param args.request - Incoming request; carries the mobile bearer auth and
 *   the `?orgId=` that scopes the lookup.
 * @param args.params - Route params; `kitId` identifies the kit.
 * @returns A JSON response: the org-scoped kit detail on success, or an
 *   `{ error }` payload with the appropriate status on failure (401/403 for
 *   auth or `kit:read` failures, 404 for a foreign-org or missing kit id).
 * @see {@link file://./assets.$assetId.ts} the asset twin of this route
 */
export async function loader({ request, params }: LoaderFunctionArgs) {
  try {
    const { user } = await requireMobileAuth(request);
    const organizationId = await requireOrganizationAccess(request, user.id);

    await requireMobilePermission({
      userId: user.id,
      organizationId,
      entity: PermissionEntity.kit,
      action: PermissionAction.read,
    });

    const { kitId } = getParams(params, z.object({ kitId: z.string() }));

    const kit = await db.kit.findFirst({
      // org-scoped lookup — a foreign-org kit id resolves to null (404)
      where: { id: kitId, organizationId },
      select: {
        id: true,
        name: true,
        description: true,
        status: true,
        image: true,
        imageExpiration: true,
        createdAt: true,
        updatedAt: true,
        category: { select: { id: true, name: true, color: true } },
        location: { select: { id: true, name: true } },
        qrCodes: { select: { id: true } },
        organization: { select: { currency: true } },
        custody: {
          select: {
            createdAt: true,
            custodian: {
              select: {
                id: true,
                name: true,
                user: {
                  select: { firstName: true, lastName: true, email: true },
                },
              },
            },
          },
        },
        // Kit ↔ Asset membership is the AssetKit pivot (see schema).
        // Select through the pivot and synthesise a flat `assets` array
        // below so the mobile JSON contract stays unchanged for the
        // companion app (kit screen still receives `kit.assets[]`).
        assetKits: {
          select: {
            asset: {
              select: {
                id: true,
                title: true,
                status: true,
                valuation: true,
                // QT-aware total value: quantity is needed so the reducer
                // below can multiply per-unit valuation × quantity for
                // QUANTITY_TRACKED assets. INDIVIDUAL assets are always
                // quantity: 1, so the math collapses to the prior behaviour.
                quantity: true,
                mainImage: true,
                thumbnailImage: true,
                category: { select: { id: true, name: true } },
                // Post-Phase-4b: `Asset.location` was replaced by the
                // `AssetLocation` pivot. Project the primary placement
                // through the pivot and flatten back to a single `location`
                // field below so the mobile JSON contract stays unchanged.
                assetLocations: {
                  select: { location: { select: { id: true, name: true } } },
                  take: 1,
                },
              },
            },
          },
          orderBy: { asset: { title: "asc" } },
        },
      },
    });

    if (!kit) {
      return data(
        { error: { message: "Kit not found in this workspace." } },
        { status: 404 }
      );
    }

    // Flatten the AssetKit pivot into the asset list the companion expects.
    // Also flatten the `assetLocations[0]` pivot back into the singular
    // `location` field the companion's kit screen still reads (preserves
    // the existing mobile JSON contract).
    const { assetKits, ...kitData } = kit;
    const assets = assetKits.map((ak) => {
      const { assetLocations, ...rest } = ak.asset;
      return { ...rest, location: assetLocations[0]?.location ?? null };
    });

    // Total value = sum of the contained assets' valuation (a kit has no own
    // value field), mirroring the web kit overview's summed valuation.
    // QT-aware: multiplies valuation × quantity. Non-breaking — same response
    // field, more accurate value for kits containing QT assets.
    const totalValue = assets.reduce(
      (sum, asset) => sum + getAssetTotalValue(asset),
      0
    );

    return data({ kit: { ...kitData, assets, totalValue } });
  } catch (cause) {
    const reason = makeShelfError(cause);
    return data(
      { error: { message: reason.message } },
      { status: reason.status }
    );
  }
}
