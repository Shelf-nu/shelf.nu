import { data, type ActionFunctionArgs } from "react-router";
import { z } from "zod";
import { db } from "~/database/db.server";
import { requireMobileAuth } from "~/modules/api/mobile-auth.server";
import { createNote } from "~/modules/note/service.server";
import { makeShelfError } from "~/utils/error";

/**
 * POST /api/mobile/asset/add-note
 *
 * Adds a comment note to an asset's activity log.
 * Body: { assetId: string, content: string }
 */
export async function action({ request }: ActionFunctionArgs) {
  try {
    const { user } = await requireMobileAuth(request);

    const body = await request.json();
    const { assetId, content } = z
      .object({
        assetId: z.string().min(1),
        content: z.string().min(1).max(5000),
      })
      .parse(body);

    // Verify asset exists and user has access
    const asset = await db.asset.findUnique({
      where: { id: assetId },
      select: { id: true, organizationId: true },
    });

    if (!asset) {
      return data({ error: { message: "Asset not found" } }, { status: 404 });
    }

    // Verify user has access to the asset's org
    const membership = await db.userOrganization.findUnique({
      where: {
        userId_organizationId: {
          userId: user.id,
          organizationId: asset.organizationId,
        },
      },
      select: { id: true },
    });

    if (!membership) {
      return data({ error: { message: "Access denied" } }, { status: 403 });
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
