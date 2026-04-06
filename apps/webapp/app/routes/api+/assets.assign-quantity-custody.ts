/**
 * API Route: Assign Quantity Custody
 *
 * Handles POST requests to check out a specific quantity of a
 * QUANTITY_TRACKED asset to a team member. Validates permissions,
 * parses form data with Zod, delegates to `checkOutQuantity`, and
 * sends a success notification.
 *
 * @see {@link file://./../../modules/asset/service.server.ts} — checkOutQuantity
 * @see {@link file://./assets.bulk-assign-custody.ts} — Similar pattern for bulk custody
 */

import type { Prisma } from "@prisma/client";
import { OrganizationRoles } from "@prisma/client";
import { data, type ActionFunctionArgs } from "react-router";
import { z } from "zod";
import { checkOutQuantity } from "~/modules/asset/service.server";
import { checkAndNotifyLowStock } from "~/modules/consumption-log/low-stock.server";
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

/** Zod schema for validating the assign-quantity-custody form data */
export const AssignQuantityCustodySchema = z.object({
  assetId: z.string().min(1, "Asset ID is required"),
  teamMemberId: z.string().min(1, "Team member is required"),
  quantity: z.coerce
    .number()
    .int()
    .positive("Quantity must be a positive integer"),
  note: z.string().optional(),
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
      AssignQuantityCustodySchema
    );

    /** Validate that the team member belongs to the same organization */
    const teamMember = await getTeamMember({
      id: teamMemberId,
      organizationId,
      include: { user: true },
    }).catch((cause) => {
      throw new ShelfError({
        cause,
        title: "Team member not found",
        message: "The selected team member could not be found.",
        additionalData: { userId, assetId, teamMemberId },
        label: "Assets",
        status: 404,
      });
    });

    /** Self-service users can only assign custody to themselves */
    if (
      role === OrganizationRoles.SELF_SERVICE &&
      teamMember.userId !== userId
    ) {
      throw new ShelfError({
        cause: null,
        title: "Action not allowed",
        message: "Self-service users can only assign custody to themselves.",
        additionalData: { userId, assetId, teamMemberId },
        label: "Assets",
        status: 403,
        shouldBeCaptured: false,
      });
    }

    await checkOutQuantity({
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

    const isSelfService = role === OrganizationRoles.SELF_SERVICE;
    const baseLine = isSelfService
      ? `${actor} took custody of **${quantity}** unit(s).`
      : `${actor} assigned **${quantity}** unit(s) to ${custodianDisplay}.`;
    const noteContent = note ? `${baseLine} *"${note}"*` : baseLine;

    await createNote({
      content: noteContent,
      type: "UPDATE",
      userId,
      assetId,
    });

    sendNotification({
      title: `${quantity} unit(s) assigned to ${teamMember.name}`,
      message: "The quantity has been checked out successfully.",
      icon: { name: "success", variant: "success" },
      senderId: userId,
    });

    /** Check low-stock threshold and notify if breached */
    await checkAndNotifyLowStock({ assetId, userId, organizationId });

    return data(payload({ success: true }));
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    return data(error(reason), { status: reason.status });
  }
}
