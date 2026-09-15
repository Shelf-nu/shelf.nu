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
  getMobileUserContext,
  requireMobileAuth,
  requireMobilePermission,
  requireOrganizationAccess,
} from "~/modules/api/mobile-auth.server";
import { viewerCanSeeLegacyCustody } from "~/modules/api/mobile-custody-visibility.server";
import { serializeAssetImage } from "~/modules/asset/image-resolution";
import { ASSET_MODEL_IMAGE_SELECT } from "~/modules/asset/image-select";
import { refreshExpiredKitImages } from "~/modules/kit/service.server";
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
 * through to the asset detail screen). A kit image whose signed URL has
 * lapsed is re-signed, and the new URL written back to the kit, before it is
 * sent.
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
    const { canSeeAllCustody } = await getMobileUserContext(
      user.id,
      organizationId
    );

    await requireMobilePermission({
      userId: user.id,
      organizationId,
      entity: PermissionEntity.kit,
      action: PermissionAction.read,
    });

    const { kitId } = getParams(params, z.object({ kitId: z.string() }));

    const storedKit = await db.kit.findFirst({
      // org-scoped lookup — a foreign-org kit id resolves to null (404)
      where: { id: kitId, organizationId },
      select: {
        id: true,
        // Scopes the write-back of a re-signed image below.
        organizationId: true,
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
                // why: needed to tell the viewer's OWN custody from a
                // colleague's — without it the visibility check below cannot
                // distinguish them and would have to hide both.
                userId: true,
                user: {
                  select: {
                    firstName: true,
                    lastName: true,
                    displayName: true,
                    email: true,
                  },
                },
              },
            },
          },
        },
        // Kit ↔ Asset membership is the AssetKit pivot (see schema).
        // Select through the pivot and synthesise the flat `kit.assets[]`
        // array below, which is the shape the companion's kit screen reads.
        assetKits: {
          select: {
            // AssetKit.quantity — units of THIS asset held by THIS kit (the
            // correct kit-surface multiplier; NOT the asset's workspace
            // stock). See .claude/rules/quantity-semantics-per-surface.md.
            quantity: true,
            asset: {
              select: {
                id: true,
                title: true,
                status: true,
                valuation: true,
                // Workspace stock — kept for parity with other mobile asset
                // payloads, but NOT used for this kit's totalValue math
                // below (that uses the pivot's `quantity` above instead).
                quantity: true,
                unitOfMeasure: true,
                type: true,
                mainImage: true,
                thumbnailImage: true,
                // Model cover image; collapsed into the flat image fields by
                // `serializeAssetImage` below, so a member asset inheriting
                // its model's photo is not blank on the kit detail screen.
                ...ASSET_MODEL_IMAGE_SELECT,
                category: { select: { id: true, name: true } },
                // Placement lives on the `AssetLocation` pivot. Project the
                // primary placement through it; it is flattened below into
                // the single `location` field the mobile JSON contract
                // carries.
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

    if (!storedKit) {
      return data(
        { error: { message: "Kit not found in this workspace." } },
        { status: 404 }
      );
    }

    // A kit's `image` is a signed storage URL that stops working once
    // `imageExpiration` passes, and the app has no way to renew it. Re-sign a
    // lapsed one so the kit screen never receives a dead link. `organizationId`
    // only scopes that write-back, so it is dropped before the response.
    const [refreshedKit] = await refreshExpiredKitImages([storedKit]);
    const { organizationId: _organizationId, ...kit } = refreshedKit;

    // Flatten the AssetKit pivot into the asset list the companion expects.
    // Also flatten the `assetLocations[0]` pivot back into the singular
    // `location` field the companion's kit screen still reads (preserves
    // the existing mobile JSON contract).
    const { assetKits, ...kitData } = kit;
    const assets = assetKits.map((ak) => {
      const { assetLocations, ...rest } = ak.asset;
      return {
        // Resolves the model-image cascade and drops the nested `assetModel`,
        // so the companion keeps one source of truth for the image.
        ...serializeAssetImage(rest),
        location: assetLocations[0]?.location ?? null,
        // Per-membership units of this asset in this kit (AssetKit.quantity).
        kitQuantity: ak.quantity,
      };
    });

    // Kit total value = Σ per-unit valuation × units-in-this-kit. Uses the kit
    // slice quantity (AssetKit.quantity), NOT the asset's workspace stock —
    // see .claude/rules/quantity-semantics-per-surface.md. INDIVIDUAL members
    // have AssetKit.quantity = 1 so the math is unchanged for them.
    const totalValue = assets.reduce(
      (sum, asset) => sum + (asset.valuation ?? 0) * asset.kitQuantity,
      0
    );

    /**
     * `kit: read` is held by BASE and SELF_SERVICE, and this select reaches
     * `custodian.user.email`. For a viewer who may not see the holder, null
     * the whole custody object rather than emptying the custodian: that is the
     * established shape on the mobile surface, and the mobile asset detail
     * route does the same with its legacy custody field.
     */
    const visibleCustody =
      kitData.custody &&
      viewerCanSeeLegacyCustody({
        custodianUserId: kitData.custody.custodian.userId,
        viewerUserId: user.id,
        canSeeAllCustody,
      })
        ? kitData.custody
        : null;

    return data({
      kit: { ...kitData, custody: visibleCustody, assets, totalValue },
    });
  } catch (cause) {
    const reason = makeShelfError(cause);
    return data(
      { error: { message: reason.message } },
      { status: reason.status }
    );
  }
}
