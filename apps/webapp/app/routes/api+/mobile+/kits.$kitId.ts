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
        assets: {
          select: {
            id: true,
            title: true,
            status: true,
            valuation: true,
            mainImage: true,
            thumbnailImage: true,
            category: { select: { id: true, name: true } },
            location: { select: { id: true, name: true } },
          },
          orderBy: { title: "asc" },
        },
      },
    });

    if (!kit) {
      return data(
        { error: { message: "Kit not found in this workspace." } },
        { status: 404 }
      );
    }

    // Total value = sum of the contained assets' valuation (a kit has no own
    // value field), mirroring the web kit overview's summed valuation.
    const totalValue = kit.assets.reduce(
      (sum, asset) => sum + (asset.valuation ?? 0),
      0
    );

    return data({ kit: { ...kit, totalValue } });
  } catch (cause) {
    const reason = makeShelfError(cause);
    return data(
      { error: { message: reason.message } },
      { status: reason.status }
    );
  }
}
