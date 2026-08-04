/**
 * API Route: Release Quantity Custody
 *
 * Handles POST requests that end a team member's hold on a specific quantity of
 * a QUANTITY_TRACKED asset. Validates permissions, parses form data with Zod,
 * delegates to `releaseQuantity`, and sends a success notification.
 *
 * **What happens to the units is decided server-side** from the asset's
 * `consumptionType` (see `resolveReleaseDisposition`), never by the caller:
 *
 * - `RETURN` (`TWO_WAY`, and legacy rows with no `consumptionType`) — the units
 *   go back into the available pool and `Asset.quantity` is untouched.
 * - `CONSUME` (`ONE_WAY` consumables) — the units were used up, so
 *   `Asset.quantity` is permanently decremented.
 *
 * The audit note and the toast are worded from the `disposition` the service
 * reports back, so what the operator reads always matches what was persisted.
 *
 * @see {@link file://./../../modules/asset/service.server.ts} — releaseQuantity
 * @see {@link file://./assets.assign-quantity-custody.ts} — Counterpart checkout route
 * @see {@link file://./mobile+/custody.release-quantity.ts} — the mirrored mobile route
 */

import type { Prisma } from "@prisma/client";
import { OrganizationRoles } from "@prisma/client";
import { data, type ActionFunctionArgs } from "react-router";
import { z } from "zod";
import { releaseQuantity } from "~/modules/asset/service.server";
import { checkAndNotifyLowStock } from "~/modules/consumption-log/low-stock.server";
import { createNote } from "~/modules/note/service.server";
import { getTeamMember } from "~/modules/team-member/service.server";
import { getUserByID } from "~/modules/user/service.server";
import { sendNotification } from "~/utils/emitter/send-notification.server";
import { makeShelfError, ShelfError } from "~/utils/error";
import { assertIsPost, payload, error, parseData } from "~/utils/http.server";
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
import { requirePermission } from "~/utils/roles.server";

/** Zod schema for validating the release-quantity-custody form data */
export const ReleaseQuantityCustodySchema = z.object({
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

export async function action({ context, request }: ActionFunctionArgs) {
  const authSession = context.getSession();
  const userId = authSession.userId;

  try {
    assertIsPost(request);

    const { organizationId, role } = await requirePermission({
      request,
      userId,
      entity: PermissionEntity.asset,
      action: PermissionAction.custody,
    });

    const formData = await request.formData();

    const { assetId, teamMemberId, quantity, note } = parseData(
      formData,
      ReleaseQuantityCustodySchema
    );

    /** Fetch team member with user info for the audit note */
    const teamMember = await getTeamMember({
      id: teamMemberId,
      organizationId,
      include: { user: true },
    });

    /** Self-service users can only release their own custody */
    if (
      role === OrganizationRoles.SELF_SERVICE &&
      teamMember.userId !== userId
    ) {
      throw new ShelfError({
        cause: null,
        title: "Action not allowed",
        message: "Self-service users can only release their own custody.",
        additionalData: { userId, assetId, teamMemberId },
        label: "Assets",
        status: 403,
        shouldBeCaptured: false,
      });
    }

    /**
     * The service decides RETURN vs CONSUME from `Asset.consumptionType` and
     * reports it back, so the audit note and the toast below describe what was
     * actually persisted instead of re-deriving the branch here.
     */
    const { disposition } = await releaseQuantity({
      assetId,
      teamMemberId,
      quantity,
      userId,
      organizationId,
      note,
    });
    const wasConsumed = disposition === "CONSUME";

    /** Best-effort audit note — don't fail the action if note creation fails */
    try {
      const user = await getUserByID(userId, {
        select: {
          id: true,
          firstName: true,
          lastName: true,
        } satisfies Prisma.UserSelect,
      });

      const actor = wrapUserLinkForNote(user);
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

      const baseLine = wasConsumed
        ? `${actor} marked **${quantity}** unit(s) held by ${custodianDisplay} as consumed. Stock reduced permanently.`
        : `${actor} released **${quantity}** unit(s) from ${custodianDisplay}'s custody.`;
      const noteContent = appendUserTextToNote(baseLine, note);

      await createNote({
        content: noteContent,
        type: "UPDATE",
        userId,
        assetId,
        organizationId,
      });
    } catch (noteError) {
      Logger.error(
        new ShelfError({
          cause: noteError,
          message: "Failed to create audit note for quantity operation",
          label: "Assets",
          additionalData: { assetId, userId },
        })
      );
    }

    sendNotification({
      title: wasConsumed
        ? `${quantity} unit(s) marked as consumed`
        : `${quantity} unit(s) released successfully`,
      message: wasConsumed
        ? "The units were used up and have been removed from stock."
        : "The quantity has been returned to the available pool.",
      icon: { name: "success", variant: "success" },
      senderId: userId,
    });

    // Either disposition moves the asset across its low-stock threshold, in
    // opposite directions: a RETURN raises available stock (so a stale
    // `lowStockNotifiedAt` marker must be cleared, and the "back in stock"
    // notice sent, or the next genuine alert is suppressed), while a CONSUME
    // lowers `Asset.quantity` outright and may TRIP the threshold. Run the
    // debounced notifier for both. Best-effort: `releaseQuantity` has already
    // committed, so a notifier failure must NOT surface as an action error
    // (the client could retry the non-idempotent release).
    try {
      await checkAndNotifyLowStock({ assetId, userId, organizationId });
    } catch (lowStockError) {
      Logger.error(
        new ShelfError({
          cause: lowStockError,
          message: "Failed to run low-stock check after custody release",
          label: "Assets",
          additionalData: { assetId, organizationId },
        })
      );
    }

    return data(payload({ success: true }));
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    return data(error(reason), { status: reason.status });
  }
}
