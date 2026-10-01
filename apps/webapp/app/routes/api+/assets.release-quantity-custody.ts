/**
 * API Route: Release Quantity Custody
 *
 * Handles POST requests that end a team member's hold on a specific quantity of
 * a QUANTITY_TRACKED asset. Validates permissions, parses form data with Zod,
 * delegates to `releaseQuantityFromCustodian` (the release, its audit note
 * and the low-stock check), and sends a success notification.
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
 * The audit note and the toast are worded from the split the service reports
 * back, so what the operator reads always matches what was persisted.
 *
 * @see {@link file://./../../modules/custody/quantity-custody.server.ts} releaseQuantityFromCustodian
 * @see {@link file://./assets.assign-quantity-custody.ts} — Counterpart checkout route
 * @see {@link file://./mobile+/custody.release-quantity.ts} — the mirrored mobile route
 */

import { OrganizationRoles } from "@prisma/client";
import { data, type ActionFunctionArgs } from "react-router";
import { z } from "zod";
import {
  QUANTITY_CUSTODIAN_SELECT,
  releaseQuantityFromCustodian,
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

/** Zod schema for validating the release-quantity-custody form data */
export const ReleaseQuantityCustodySchema = z.object({
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

    const { assetId, teamMemberId, quantity, consumed, note } = parseData(
      formData,
      ReleaseQuantityCustodySchema
    );

    /** Fetch team member with user info for the audit note */
    const teamMember = await getTeamMember({
      id: teamMemberId,
      organizationId,
      select: { ...QUANTITY_CUSTODIAN_SELECT, userId: true },
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
     * The service resolves the split from `Asset.consumptionType` when the
     * caller sends no `consumed`, and reports back what it persisted, so the
     * toast below describes what was written.
     */
    const { consumed: consumedUnits, returned: returnedUnits } =
      await releaseQuantityFromCustodian({
        assetId,
        custodian: teamMember,
        quantity,
        consumed,
        userId,
        organizationId,
        role,
        note,
      });

    sendNotification({
      title:
        consumedUnits > 0 && returnedUnits > 0
          ? `${consumedUnits} consumed, ${returnedUnits} returned`
          : consumedUnits > 0
          ? `${consumedUnits} unit(s) marked as consumed`
          : `${returnedUnits} unit(s) released successfully`,
      message:
        consumedUnits > 0 && returnedUnits > 0
          ? "The consumed units were removed from stock; the rest are back in the available pool."
          : consumedUnits > 0
          ? "The units were used up and have been removed from stock."
          : "The quantity has been returned to the available pool.",
      icon: { name: "success", variant: "success" },
      senderId: userId,
    });

    return data(payload({ success: true }));
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    return data(error(reason), { status: reason.status });
  }
}
