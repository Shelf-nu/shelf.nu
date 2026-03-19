import { data, type ActionFunctionArgs } from "react-router";
import { z } from "zod";
import { db } from "~/database/db.server";
import {
  requireMobileAuth,
  requireMobilePermission,
  requireOrganizationAccess,
} from "~/modules/api/mobile-auth.server";
import { createNote } from "~/modules/note/service.server";
import { makeShelfError } from "~/utils/error";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";

/**
 * POST /api/mobile/asset/add-note
 *
 * Adds a comment note to an asset's activity log.
 * Body: { assetId: string, content: string }
 */
export async function action({ request }: ActionFunctionArgs) {
  try {
    const { user } = await requireMobileAuth(request);
    const organizationId = await requireOrganizationAccess(request, user.id);

    await requireMobilePermission({
      userId: user.id,
      organizationId,
      entity: PermissionEntity.asset,
      action: PermissionAction.update,
    });

    const body = await request.json();
    const { assetId, content } = z
      .object({
        assetId: z.string().min(1),
        content: z.string().min(1).max(5000),
      })
      .parse(body);

    // Verify asset exists and belongs to the organization
    const asset = await db.asset.findUnique({
      where: { id: assetId, organizationId },
      select: { id: true },
    });

    if (!asset) {
      return data({ error: { message: "Asset not found" } }, { status: 404 });
    }

    const note = await createNote({
      content,
      type: "COMMENT",
      userId: user.id,
      assetId,
    });

    return data({ note });
  } catch (cause) {
    const reason = makeShelfError(cause);
    return data(
      { error: { message: reason.message } },
      { status: reason.status }
    );
  }
}
