import { data, type ActionFunctionArgs } from "react-router";
import { z } from "zod";
import { db } from "~/database/db.server";
import {
  requireMobileAuth,
  requireMobilePermission,
  requireOrganizationAccess,
} from "~/modules/api/mobile-auth.server";
import { releaseCustody } from "~/modules/custody/service.server";
import { createNote } from "~/modules/note/service.server";
import { makeShelfError } from "~/utils/error";
import { wrapUserLinkForNote } from "~/utils/markdoc-wrappers";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";

/**
 * POST /api/mobile/custody/release
 *
 * Releases custody of an asset (checks it back in).
 * Body: { assetId: string }
 */
export async function action({ request }: ActionFunctionArgs) {
  try {
    const { user } = await requireMobileAuth(request);
    const organizationId = await requireOrganizationAccess(request, user.id);

    await requireMobilePermission({
      userId: user.id,
      organizationId,
      entity: PermissionEntity.asset,
      action: PermissionAction.custody,
    });

    const body = await request.json();
    const { assetId } = z
      .object({
        assetId: z.string().min(1),
      })
      .parse(body);

    // why: read the current custody record so we can attach actor +
    // teamMember + targetUser to the CUSTODY_RELEASED activity event.
    // releaseCustody only emits the event when activityEvent is provided
    // (it's optional in the helper signature) — mirrors the pattern used
    // in assets.$assetId.overview.release-custody.tsx.
    const custodyRecord = await db.custody.findUnique({
      where: { assetId },
      select: {
        custodian: {
          select: { id: true, user: { select: { id: true } } },
        },
      },
    });

    const asset = await releaseCustody({
      assetId,
      organizationId,
      activityEvent: {
        actorUserId: user.id,
        teamMemberId: custodyRecord?.custodian?.id,
        targetUserId: custodyRecord?.custodian?.user?.id,
      },
    });

    // Create a note for the activity log (matches webapp format)
    const actor = wrapUserLinkForNote({
      id: user.id,
      firstName: user.firstName,
      lastName: user.lastName,
    });

    await createNote({
      content: `${actor} released custody via mobile app.`,
      type: "UPDATE",
      userId: user.id,
      assetId: asset.id,
    });

    return data({ asset });
  } catch (cause) {
    const reason = makeShelfError(cause);
    return data(
      { error: { message: reason.message } },
      { status: reason.status }
    );
  }
}
