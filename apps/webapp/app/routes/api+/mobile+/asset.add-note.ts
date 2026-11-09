import { data, type ActionFunctionArgs } from "react-router";
import { z } from "zod";
import { db } from "~/database/db.server";
import {
  requireMobileAuth,
  requireMobilePermission,
  requireOrganizationAccess,
} from "~/modules/api/mobile-auth.server";
import { parseMobileBody } from "~/modules/api/mobile-body.server";
import { createNote } from "~/modules/note/service.server";
import { NOTE_MAX_CONTENT_LENGTH } from "~/utils/constants";
import { makeShelfError } from "~/utils/error";
import { stripMarkdocDelimiters } from "~/utils/markdoc-sanitize";
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
      entity: PermissionEntity.note,
      action: PermissionAction.create,
    });

    const { assetId, content } = await parseMobileBody(
      z.object({
        assetId: z.string().min(1),
        // Strip Markdoc delimiters so the comment renders as text, never as a
        // live tag, matching the web note schema.
        content: z
          .string()
          .max(NOTE_MAX_CONTENT_LENGTH)
          .transform(stripMarkdocDelimiters)
          .pipe(z.string().min(1)),
      }),
      request,
      "Assets"
    );

    // Verify asset exists and belongs to the organization
    const asset = await db.asset.findUnique({
      // eslint-disable-next-line local-rules/require-archived-at-check-on-asset-queries -- why: org-ownership check for notes on an asset's own page, which stays usable for archived assets
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
      organizationId,
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
