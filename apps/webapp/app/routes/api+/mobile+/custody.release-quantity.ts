/**
 * POST /api/mobile/custody/release-quantity
 *
 * Ends a team member's hold on N units of a QUANTITY_TRACKED asset. Mobile twin
 * of the web's `/api/assets/release-quantity-custody` route — same Zod schema,
 * same SELF_SERVICE guard, same `releaseQuantity` service call, same
 * best-effort audit note.
 *
 * **What happens to the units is decided server-side** from the asset's
 * `consumptionType` (see `releaseCategory` in `@shelf/quantity-control`), with
 * an optional operator-supplied split:
 *
 * - `RETURN` (`TWO_WAY`, and legacy rows with no `consumptionType`) — the units
 *   go back into the available pool and `Asset.quantity` is untouched. These
 *   assets reject a non-zero `consumed`.
 * - `CONSUME` (`ONE_WAY` consumables) — the units default to used-up, so
 *   `Asset.quantity` is permanently decremented. A `consumed` field below the
 *   released quantity hands the remainder back instead.
 *
 * The audit note is worded from the split the service reports back, so what the
 * operator reads always matches what was persisted.
 *
 * Runs the debounced low-stock notifier (best-effort) after every release.
 * Available stock is `Asset.quantity - SUM(Custody.quantity)`: ending a hold
 * drops custody by the full release and total by the consumed part, so
 * available rises by exactly the RETURNED units — and is unchanged when
 * everything was consumed. The notifier still runs so a recovery clears the
 * now-stale debounce marker and sends the recovery notice, or the next genuine
 * alert is suppressed. Mirrors the web route.
 *
 * Body: { assetId: string, teamMemberId: string, quantity: number, consumed?: number, note?: string }
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
import { checkAndNotifyLowStock } from "~/modules/consumption-log/low-stock.server";
import { createNote } from "~/modules/note/service.server";
import { getTeamMember } from "~/modules/team-member/service.server";
import { getUserByID } from "~/modules/user/service.server";
import { makeShelfError, ShelfError } from "~/utils/error";
import { Logger } from "~/utils/logger";
import {
  appendUserTextToNote,
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
  /**
   * How many of the released units were used up. Optional: when absent the
   * server derives it from the asset's consumptionType. Only a consumable
   * accepts a non-zero value, which the service enforces.
   */
  consumed: z.coerce.number().int().nonnegative().optional(),
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
    const { assetId, teamMemberId, quantity, consumed, note } = parsed.data;

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
    /**
     * The service resolves the split from `Asset.consumptionType` when the
     * caller sends no `consumed`, and reports back what it persisted — so the
     * audit note below describes reality instead of re-deriving the branch
     * here. App builds predating the field simply omit it and keep the
     * server-derived outcome they always had.
     */
    const { consumed: consumedUnits, returned: returnedUnits } =
      await releaseQuantity({
        assetId,
        teamMemberId,
        quantity,
        consumed,
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
          displayName: true,
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
                displayName: teamMember.user.displayName,
              }
            : null,
        },
      });

      /**
       * Same three shapes the web route writes, so an activity feed reads the
       * same whichever client performed the release.
       */
      const baseLine =
        consumedUnits > 0 && returnedUnits > 0
          ? `${actor} ended ${custodianDisplay}'s hold on **${quantity}** unit(s): **${consumedUnits}** consumed and **${returnedUnits}** returned to stock.`
          : consumedUnits > 0
          ? `${actor} marked **${consumedUnits}** unit(s) held by ${custodianDisplay} as consumed. Stock reduced permanently.`
          : `${actor} released **${returnedUnits}** unit(s) from ${custodianDisplay}'s custody.`;
      const noteContent = appendUserTextToNote(baseLine, note);

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

    // Available stock is `Asset.quantity - SUM(Custody.quantity)`. Ending a
    // hold drops custody by the full release and total by the consumed part,
    // so available rises by exactly the RETURNED units — and is unchanged when
    // everything was consumed. Run the notifier so a recovery clears the
    // now-stale debounce marker and sends the recovery notice, or the next
    // genuine alert is suppressed. Best-effort: releaseQuantity has already
    // committed, so a notifier failure must NOT surface as an action error
    // (the client could retry the non-idempotent release).
    try {
      await checkAndNotifyLowStock({
        assetId,
        userId: user.id,
        organizationId,
      });
    } catch (lowStockError) {
      Logger.error(
        new ShelfError({
          cause: lowStockError,
          message: "Failed to run low-stock check after mobile custody release",
          label: "Assets",
          additionalData: { assetId, organizationId },
        })
      );
    }

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
