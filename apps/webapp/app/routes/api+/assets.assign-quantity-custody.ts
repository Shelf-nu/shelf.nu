/**
 * API Route: Assign Quantity Custody
 *
 * Handles POST requests to check out a specific quantity of a
 * QUANTITY_TRACKED asset to a team member. Validates permissions,
 * parses form data with Zod, delegates to `assignQuantityToCustodian` (the
 * custody change, its audit note and the low-stock check), and sends a
 * success notification.
 *
 * @see {@link file://./../../modules/custody/quantity-custody.server.ts} assignQuantityToCustodian
 * @see {@link file://./assets.bulk-assign-custody.ts} the bulk route, which uses the same function
 */

import { data, type ActionFunctionArgs } from "react-router";
import { z } from "zod";
import {
  assignQuantityToCustodian,
  QUANTITY_CUSTODIAN_SELECT,
} from "~/modules/custody/quantity-custody.server";
import { getTeamMember } from "~/modules/team-member/service.server";
import { sendNotification } from "~/utils/emitter/send-notification.server";
import { makeShelfError, ShelfError } from "~/utils/error";
import { assertIsPost, payload, error, parseData } from "~/utils/http.server";
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

    const { organizationId, access } = await requirePermission({
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
      select: { ...QUANTITY_CUSTODIAN_SELECT, userId: true },
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

    /** A caller whose custody scope is `self` may assign only to themselves */
    const assignsSelfOnly = access.custody.assign === "self";
    if (assignsSelfOnly && teamMember.userId !== userId) {
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

    await assignQuantityToCustodian({
      assetId,
      custodian: teamMember,
      quantity,
      userId,
      organizationId,
      custodyAssign: access.custody.assign,
      note,
    });

    sendNotification({
      title: `${quantity} unit(s) assigned to ${teamMember.name}`,
      message: "The quantity has been checked out successfully.",
      icon: { name: "success", variant: "success" },
      senderId: userId,
    });

    return data(payload({ success: true }));
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    return data(error(reason), { status: reason.status });
  }
}
