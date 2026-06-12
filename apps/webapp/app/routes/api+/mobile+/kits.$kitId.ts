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

    return data({ kit });
  } catch (cause) {
    const reason = makeShelfError(cause);
    return data(
      { error: { message: reason.message } },
      { status: reason.status }
    );
  }
}
