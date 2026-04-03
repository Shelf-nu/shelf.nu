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

import { data, type ActionFunctionArgs } from "react-router";
import { z } from "zod";
import { releaseQuantity } from "~/modules/asset/service.server";
import { sendNotification } from "~/utils/emitter/send-notification.server";
import { makeShelfError } from "~/utils/error";
import { assertIsPost, payload, error, parseData } from "~/utils/http.server";
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
  note: z.string().optional(),
});

export async function action({ context, request }: ActionFunctionArgs) {
  const authSession = context.getSession();
  const userId = authSession.userId;

  try {
    assertIsPost(request);

    const { organizationId } = await requirePermission({
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

    await releaseQuantity({
      assetId,
      teamMemberId,
      quantity,
      userId,
      organizationId,
      note,
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
