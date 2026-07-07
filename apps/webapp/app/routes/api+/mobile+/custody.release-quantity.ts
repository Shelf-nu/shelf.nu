/**
 * POST /api/mobile/custody/release-quantity
 *
 * Releases (returns) N units of a QUANTITY_TRACKED asset from a team member
 * back to the available pool. Mobile twin of the web's
 * `/api/assets/release-quantity-custody` route — same Zod schema, same
 * SELF_SERVICE guard, same `releaseQuantity` service call, same best-effort
 * audit note. Deliberately NO low-stock check: release ADDS stock back, and
 * the web release route has none either (verified: no
 * `checkAndNotifyLowStock` import/call in that file).
 *
 * Body: { assetId: string, teamMemberId: string, quantity: number, note?: string }
 * Org: `?orgId=` query param or `x-shelf-organization` header.
 *
 * Success envelope: `{ success: true, asset }` where `asset` is the
 * refreshed asset shaped for mobile (custody visibility already filtered
 * for the caller) so the app can update state without a second round trip.
 *
 * @see {@link file://./../assets.release-quantity-custody.ts} — the mirrored web route
 * @see {@link file://./../../../modules/asset/service.server.ts} — releaseQuantity
 * @see {@link file://./custody.assign-quantity.ts} — counterpart assign route
 */

import type { Prisma } from "@prisma/client";
import { OrganizationRoles } from "@prisma/client";
import { data, type ActionFunctionArgs } from "react-router";
import { z } from "zod";
import {
  getMobileAssetForViewer,
  getMobileUserContext,
  requireMobileAuth,
  requireMobilePermission,
  requireOrganizationAccess,
} from "~/modules/api/mobile-auth.server";
import { releaseQuantity } from "~/modules/asset/service.server";
import { createNote } from "~/modules/note/service.server";
import { getTeamMember } from "~/modules/team-member/service.server";
import { getUserByID } from "~/modules/user/service.server";
import { makeShelfError, ShelfError } from "~/utils/error";
import { Logger } from "~/utils/logger";
import {
  wrapCustodianForNote,
  wrapUserLinkForNote,
} from "~/utils/markdoc-wrappers";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { enforceUserRateLimit } from "~/utils/rate-limit.server";

/**
 * Zod schema for the release-quantity-custody JSON body. Identical to the
 * web's `ReleaseQuantityCustodySchema` (assets.release-quantity-custody.ts).
 */
const ReleaseQuantityCustodySchema = z.object({
  assetId: z.string().min(1, "Asset ID is required"),
  teamMemberId: z.string().min(1, "Team member is required"),
  quantity: z.coerce
    .number()
    .int()
    .positive("Quantity must be a positive integer"),
  note: z
    .string()
    .optional()
    .transform((val) => (val === "" ? undefined : val)),
});

export async function action({ request }: ActionFunctionArgs) {
  let userId: string | undefined;

  try {
    const { user } = await requireMobileAuth(request);
    userId = user.id;
    // Same limiter bucket as the other mobile custody mutations — a stuck
    // retry loop or rapid taps shouldn't hammer a row-locking transaction.
    await enforceUserRateLimit(user.id, "bulk");

    const organizationId = await requireOrganizationAccess(request, user.id);

    // RBAC: require asset:custody permission (SELF_SERVICE passes, BASE 403s
    // — same Role2PermissionMap as the web quantity routes)
    await requireMobilePermission({
      userId: user.id,
      organizationId,
      entity: PermissionEntity.asset,
      action: PermissionAction.custody,
    });

    // Role for the SELF_SERVICE guard below; canSeeAllCustody for shaping
    // the refreshed asset. No getAssetIndexSettings here: releaseQuantity
    // takes no `settings` param (that call is bulk-route plumbing only).
    const { role, canSeeAllCustody } = await getMobileUserContext(
      user.id,
      organizationId
    );

    // why: siblings use raw `.parse`, which surfaces a ZodError as a 500
    // through makeShelfError's unknown-error branch. The web route returns
    // 400 via parseData — safeParse + a 400 ShelfError honors that parity.
    const parsed = ReleaseQuantityCustodySchema.safeParse(await request.json());
    if (!parsed.success) {
      throw new ShelfError({
        cause: parsed.error,
        message: "Invalid request body",
        additionalData: { validationErrors: parsed.error.flatten() },
        label: "Assets",
        status: 400,
      });
    }
    const { assetId, teamMemberId, quantity, note } = parsed.data;

    /**
     * Validate that the team member belongs to the same organization.
     * The web release route omits the `.catch` wrapper (getTeamMember's own
     * error is already a 404 "Team member not found"); mobile standardizes
     * on the wrapped form used by every sibling — same surfaced 404.
     */
    const teamMember = await getTeamMember({
      id: teamMemberId,
      organizationId,
      include: { user: true },
    }).catch((cause) => {
      throw new ShelfError({
        cause,
        title: "Team member not found",
        message: "The selected team member could not be found.",
        additionalData: { userId: user.id, assetId, teamMemberId },
        label: "Assets",
        status: 404,
      });
    });

    /** Self-service users can only release their own custody */
    if (
      role === OrganizationRoles.SELF_SERVICE &&
      teamMember.userId !== user.id
    ) {
      throw new ShelfError({
        cause: null,
        title: "Action not allowed",
        message: "Self-service users can only release their own custody.",
        additionalData: { userId: user.id, assetId, teamMemberId },
        label: "Assets",
        status: 403,
        shouldBeCaptured: false,
      });
    }

    // All release validation (type gate, org mismatch, row-locked custody
    // lookup, over-release check) lives inside the service. Kit-allocated
    // custody rows are NOT releasable here by design — only the operator
    // row (kitCustodyId: null) is targeted.
    await releaseQuantity({
      assetId,
      teamMemberId,
      quantity,
      userId: user.id,
      organizationId,
      note,
    });

    /** Best-effort audit note — don't fail the action if note creation fails */
    try {
      const actorUser = await getUserByID(user.id, {
        select: {
          id: true,
          firstName: true,
          lastName: true,
        } satisfies Prisma.UserSelect,
      });

      const actor = wrapUserLinkForNote(actorUser);
      const custodianDisplay = wrapCustodianForNote({
        teamMember: {
          name: teamMember.name,
          user: teamMember.user
            ? {
                id: teamMember.user.id,
                firstName: teamMember.user.firstName,
                lastName: teamMember.user.lastName,
              }
            : null,
        },
      });

      const baseLine = `${actor} released **${quantity}** unit(s) from ${custodianDisplay}'s custody.`;
      const noteContent = note ? `${baseLine} *"${note}"*` : baseLine;

      await createNote({
        content: noteContent,
        type: "UPDATE",
        userId: user.id,
        assetId,
        organizationId,
      });
    } catch (noteError) {
      Logger.error(
        new ShelfError({
          cause: noteError,
          message: "Failed to create audit note for quantity operation",
          label: "Assets",
          additionalData: { assetId, userId: user.id },
        })
      );
    }

    // No route-level sendNotification success toast here: that's the web's
    // SSE emitter and mobile has no listener (matches custody.assign.ts).
    // And no checkAndNotifyLowStock — see the file JSDoc.

    // Refreshed asset, shaped for mobile with the caller's custody
    // visibility already applied, so the app can update state directly.
    // Best-effort: releaseQuantity has already committed, so a refresh
    // failure must NOT surface as an action error — the client would show
    // a failure (and could retry the non-idempotent release) for a release
    // that actually succeeded. Null on failure; the app refetches anyway.
    let asset = null;
    try {
      asset = await getMobileAssetForViewer({
        assetId,
        organizationId,
        viewerUserId: user.id,
        canSeeAllCustody,
      });
    } catch (refreshError) {
      Logger.error(
        new ShelfError({
          cause: refreshError,
          message: "Failed to refresh asset after quantity release",
          label: "Assets",
          additionalData: { assetId, userId: user.id },
        })
      );
    }

    return data({ success: true, asset });
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    return data(
      { error: { message: reason.message } },
      { status: reason.status }
    );
  }
}
