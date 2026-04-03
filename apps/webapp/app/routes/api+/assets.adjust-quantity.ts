/**
 * Adjust Quantity API Route
 *
 * POST-only endpoint for quick quantity adjustments on QUANTITY_TRACKED assets.
 * Supports three operations:
 *   - RESTOCK (add) — increase total stock
 *   - LOSS (subtract) — decrease total stock due to loss/damage
 *   - ADJUSTMENT (add or subtract) — correct total stock
 *
 * After a successful adjustment, checks whether available quantity has dropped
 * to or below the asset's low-stock threshold and fires an in-app notification.
 *
 * @see {@link file://../../modules/consumption-log/service.server.ts} - adjustQuantity
 * @see {@link file://../../modules/consumption-log/low-stock.server.ts} - checkAndNotifyLowStock
 * @see {@link file://./assets.bulk-assign-custody.ts} - Similar API route pattern
 */

import { data, type ActionFunctionArgs } from "react-router";
import { z } from "zod";
import { checkAndNotifyLowStock } from "~/modules/consumption-log/low-stock.server";
import { adjustQuantity } from "~/modules/consumption-log/service.server";
import { sendNotification } from "~/utils/emitter/send-notification.server";
import { makeShelfError } from "~/utils/error";
import { assertIsPost, payload, error, parseData } from "~/utils/http.server";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { requirePermission } from "~/utils/roles.server";

/** Zod schema for the adjust-quantity request body. */
export const AdjustQuantitySchema = z.object({
  assetId: z.string(),
  quantity: z.coerce.number().int().positive("Quantity must be at least 1"),
  category: z.enum(["RESTOCK", "ADJUSTMENT", "LOSS"]),
  direction: z.enum(["add", "subtract"]),
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
      action: PermissionAction.update,
    });

    const formData = await request.formData();

    const { assetId, quantity, category, direction, note } = parseData(
      formData,
      AdjustQuantitySchema
    );

    await adjustQuantity({
      assetId,
      quantity,
      category,
      direction,
      userId,
      organizationId,
      note,
    });

    /** Build a human-readable notification message */
    const sign = direction === "add" ? "+" : "-";
    sendNotification({
      title: `Quantity adjusted: ${sign}${quantity}`,
      message: "The asset quantity has been updated successfully.",
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
