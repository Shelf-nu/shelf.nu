import { data, type ActionFunctionArgs } from "react-router";
import { z } from "zod";
import { db } from "~/database/db.server";
import {
  getMobileUserContext,
  requireMobileAuth,
  requireMobilePermission,
  requireOrganizationAccess,
} from "~/modules/api/mobile-auth.server";
import { parseMobileBody } from "~/modules/api/mobile-body.server";
import { isQuantityTracked } from "~/modules/asset/utils";
import { releaseCustody } from "~/modules/custody/service.server";
import { createNote } from "~/modules/note/service.server";
import { makeShelfError, ShelfError } from "~/utils/error";
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

    // Caller's role — required so releaseCustody can enforce the SELF_SERVICE
    // self-restriction (only release custody of assets assigned to themselves).
    const { role } = await getMobileUserContext(user.id, organizationId);

    const { assetId } = await parseMobileBody(
      z.object({
        assetId: z.string().min(1),
      }),
      request,
      "Assets"
    );

    // why: `releaseCustody` is INDIVIDUAL-only — its `deleteMany` releases
    // EVERY custodian on the asset, which for a QUANTITY_TRACKED asset means
    // one custodian's release would wipe all the others' slices. The web route
    // (`assets.$assetId.overview.release-custody.tsx`) already refuses QT here;
    // this endpoint did not, so the mobile app was the one way into that state.
    // QT releases belong to POST /api/mobile/custody/release-quantity, which
    // takes a quantity and releases a single slice.
    const assetToRelease = await db.asset.findFirst({
      where: { id: assetId, organizationId },
      select: { type: true },
    });

    if (isQuantityTracked(assetToRelease)) {
      throw new ShelfError({
        cause: null,
        title: "Action not allowed",
        message:
          "Quantity-tracked assets must have custody released individually through the quantity release flow.",
        additionalData: { userId: user.id, assetId },
        label: "Assets",
        status: 400,
        shouldBeCaptured: false,
      });
    }

    // why: read the current custody record so we can attach actor +
    // teamMember + targetUser to the CUSTODY_RELEASED activity event.
    // releaseCustody only emits the event when activityEvent is provided
    // (it's optional in the helper signature) — mirrors the pattern used
    // in assets.$assetId.overview.release-custody.tsx.
    //
    // why org-scoped via `asset.organizationId`: `findUnique({ assetId })`
    // would happily return custody data for an asset in ANOTHER org
    // (assetId is globally unique but not org-scoped on its own). The
    // downstream `releaseCustody` enforces org scoping, but this pre-read
    // would still leak `custodian.id` / `custodian.user.id` cross-org if
    // an attacker guessed an asset id. Filtering on the related asset's
    // `organizationId` makes the read consistent with the rest of the
    // route's tenant boundary.
    const custodyRecord = await db.custody.findFirst({
      where: {
        assetId,
        asset: { organizationId },
      },
      select: {
        custodian: {
          select: { id: true, user: { select: { id: true } } },
        },
      },
    });

    const asset = await releaseCustody({
      assetId,
      organizationId,
      userId: user.id,
      role,
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
      organizationId,
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
