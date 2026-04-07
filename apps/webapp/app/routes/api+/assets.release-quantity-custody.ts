/**
 * API Route: Release Quantity Custody
 *
 * Handles POST requests to release (return) a specific quantity of a
 * QUANTITY_TRACKED asset from a team member back to the available pool.
 * Validates permissions, parses form data with Zod, delegates to
 * `releaseQuantity`, and sends a success notification.
 *
 * @see {@link file://./../../modules/asset/service.server.ts} — releaseQuantity
 * @see {@link file://./assets.assign-quantity-custody.ts} — Counterpart checkout route
 */

import type { Prisma } from "@prisma/client";
import { OrganizationRoles } from "@prisma/client";
import { data, type ActionFunctionArgs } from "react-router";
import { z } from "zod";
import { releaseQuantity } from "~/modules/asset/service.server";
import { createNote } from "~/modules/note/service.server";
import { getTeamMember } from "~/modules/team-member/service.server";
import { getUserByID } from "~/modules/user/service.server";
import { sendNotification } from "~/utils/emitter/send-notification.server";
import { makeShelfError, ShelfError } from "~/utils/error";
import { assertIsPost, payload, error, parseData } from "~/utils/http.server";
import {
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

    await releaseQuantity({
      assetId,
      teamMemberId,
      quantity,
      userId,
      organizationId,
      note,
    });

    /** Build and create an audit note on the asset */
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

    const baseLine = `${actor} released **${quantity}** unit(s) from ${custodianDisplay}'s custody.`;
    const noteContent = note ? `${baseLine} *"${note}"*` : baseLine;

    await createNote({
      content: noteContent,
      type: "UPDATE",
      userId,
      assetId,
    });

    sendNotification({
      title: `${quantity} unit(s) released successfully`,
      message: "The quantity has been returned to the available pool.",
      icon: { name: "success", variant: "success" },
      senderId: userId,
    });

    return data(payload({ success: true }));
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    return data(error(reason), { status: reason.status });
  }
}
