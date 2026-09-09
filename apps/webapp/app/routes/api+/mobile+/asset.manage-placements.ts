import { data, type ActionFunctionArgs } from "react-router";
import { z } from "zod";
import { db } from "~/database/db.server";
import {
  requireMobileAuth,
  requireMobilePermission,
  requireOrganizationAccess,
} from "~/modules/api/mobile-auth.server";
import { parseMobileBody } from "~/modules/api/mobile-body.server";
import { replaceAssetPlacements } from "~/modules/asset/service.server";
import {
  getPrimaryLocation,
  shapeMobileAssetPlacements,
} from "~/modules/asset/utils";
import { makeShelfError } from "~/utils/error";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { enforceUserRateLimit } from "~/utils/rate-limit.server";

/**
 * POST /api/mobile/asset/manage-placements
 *
 * Replaces an asset's MANUAL placement set with the submitted one. Mobile
 * twin of the web asset-overview "Manage placements" dialog
 * (`_layout+/assets.$assetId.overview.manage-placements.tsx`): both call
 * `replaceAssetPlacements`, which owns every invariant — duplicate/positive
 * row validation, the INDIVIDUAL one-row cap, sum-within-total against the
 * row-locked asset (409 on a concurrent total change), org scoping of every
 * location id, kit-driven rows surviving untouched, and the per-row activity
 * events + notes.
 *
 * Body: { assetId: string, placements: Array<{ locationId, quantity }> }
 *
 * `placements` is the full desired manual set — an empty array unplaces the
 * asset. `quantity` is the per-row `AssetLocation.quantity` (units placed at
 * that location — NOT `Asset.quantity`, the workspace stock).
 *
 * Success envelope: `{ asset: { id, title, location }, placements }` where
 * `placements` is the committed set (manual + read-only kit rows) in the
 * same shape the asset-detail endpoint ships, so the app can update state
 * without a second round trip.
 *
 * @see {@link file://./../../../modules/asset/service.server.ts} — replaceAssetPlacements
 * @see {@link file://./asset.update-location.ts} — the single-placement flow (INDIVIDUAL + scanner)
 */
export async function action({ request }: ActionFunctionArgs) {
  try {
    const { user } = await requireMobileAuth(request);
    // "bulk" bucket, matching the sibling quantity mutations
    // (adjust-quantity, custody.assign-quantity): one save rewrites many
    // pivot rows and fans out per-row events + notes.
    await enforceUserRateLimit(user.id, "bulk");
    const organizationId = await requireOrganizationAccess(request, user.id);

    await requireMobilePermission({
      userId: user.id,
      organizationId,
      entity: PermissionEntity.asset,
      action: PermissionAction.update,
    });

    const { assetId, placements } = await parseMobileBody(
      z.object({
        assetId: z.string().min(1),
        placements: z
          .array(
            z.object({
              locationId: z.string().min(1),
              quantity: z.number().int().positive(),
            })
          )
          // Locations are a small, bounded entity; the cap only blocks
          // pathological payloads before they reach the service.
          .max(200),
      }),
      request,
      "Assets"
    );

    await replaceAssetPlacements({
      assetId,
      organizationId,
      userId: user.id,
      placements,
    });

    // Re-read the committed rows so the response reflects the pivot ops,
    // kit-driven rows included.
    const refreshed = await db.asset.findUniqueOrThrow({
      where: { id: assetId, organizationId },
      select: {
        id: true,
        title: true,
        assetLocations: {
          select: {
            quantity: true,
            assetKitId: true,
            location: { select: { id: true, name: true } },
            assetKit: {
              select: { kit: { select: { id: true, name: true } } },
            },
          },
        },
      },
    });

    return data({
      asset: {
        id: refreshed.id,
        title: refreshed.title,
        location: getPrimaryLocation(refreshed),
      },
      placements: shapeMobileAssetPlacements(refreshed.assetLocations),
    });
  } catch (cause) {
    const reason = makeShelfError(cause);
    return data(
      { error: { message: reason.message } },
      { status: reason.status }
    );
  }
}
