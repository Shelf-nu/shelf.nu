import { OrganizationRoles } from "@prisma/client";
import { data, type ActionFunctionArgs } from "react-router";
import { z } from "zod";
import { BulkAssignKitCustodySchema } from "~/components/kits/bulk-assign-custody-dialog";
import { BulkDeleteKitsSchema } from "~/components/kits/bulk-delete-dialog";
import { KitBulkLocationUpdateSchema } from "~/components/kits/bulk-location-update-dialog";
import { BulkReleaseKitCustodySchema } from "~/components/kits/bulk-release-custody-dialog";
import { db } from "~/database/db.server";
import { CurrentSearchParamsSchema } from "~/modules/asset/utils.server";
import {
  bulkAssignKitCustody,
  bulkDeleteKits,
  bulkReleaseKitCustody,
  bulkUpdateKitLocation,
} from "~/modules/kit/service.server";
import {
  getTeamMember,
  scopeCustodianFilterIds,
} from "~/modules/team-member/service.server";
import { checkExhaustiveSwitch } from "~/utils/check-exhaustive-switch";
import { sendNotification } from "~/utils/emitter/send-notification.server";
import {
  isLikeShelfError,
  isNotFoundError,
  makeShelfError,
  ShelfError,
} from "~/utils/error";
import { payload, error, parseData } from "~/utils/http.server";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { requirePermission } from "~/utils/roles.server";

export async function action({ request, context }: ActionFunctionArgs) {
  const authSession = context.getSession();
  const userId = authSession.userId;

  try {
    const formData = await request.formData();

    const { intent, currentSearchParams } = parseData(
      formData,
      z
        .object({
          intent: z.enum([
            "bulk-delete",
            "bulk-assign-custody",
            "bulk-release-custody",
            "bulk-update-location",
          ]),
        })
        .and(CurrentSearchParamsSchema)
    );

    const intent2ActionMap: Record<typeof intent, PermissionAction> = {
      "bulk-delete": PermissionAction.delete,
      "bulk-assign-custody": PermissionAction.custody,
      "bulk-release-custody": PermissionAction.custody,
      "bulk-update-location": PermissionAction.update,
    };

    const { organizationId, role, canSeeAllCustody } = await requirePermission({
      userId,
      request,
      entity: PermissionEntity.kit,
      action: intent2ActionMap[intent],
    });
    const isSelfService = role === OrganizationRoles.SELF_SERVICE;

    /**
     * `?teamMember=` rides in on `currentSearchParams` and is applied to a
     * custody clause when the caller selects all. Both custody intents above
     * map to `PermissionAction.custody`, which SELF_SERVICE HOLDS — so this
     * must be narrowed to the caller's own ids rather than trusted.
     */
    const allowedTeamMemberIds = await scopeCustodianFilterIds({
      teamMemberIds: new URLSearchParams(currentSearchParams ?? "").getAll(
        "teamMember"
      ),
      canSeeAllCustody,
      userId,
      organizationId,
    });

    switch (intent) {
      case "bulk-delete": {
        const { kitIds } = parseData(formData, BulkDeleteKitsSchema);

        await bulkDeleteKits({
          kitIds,
          organizationId,
          userId,
          currentSearchParams,
        });

        sendNotification({
          title: "Kits deleted",
          message: "Your kits has been deleted successfully",
          icon: { name: "success", variant: "success" },
          senderId: authSession.userId,
        });

        return data(payload({ success: true }));
      }

      case "bulk-assign-custody": {
        const { kitIds, custodian } = parseData(
          formData,
          BulkAssignKitCustodySchema
        );

        // Validate that the custodian belongs to the same organization
        const teamMember = await getTeamMember({
          id: custodian.id,
          organizationId,
          select: { id: true, userId: true },
        }).catch((cause) => {
          throw new ShelfError({
            cause,
            title: "Team member not found",
            message: "The selected team member could not be found.",
            additionalData: { userId, kitIds, custodian },
            label: "Kit",
            status: 404,
            // `getTeamMember` already classifies its errors — forward that
            // decision so DB / connectivity failures inside it still reach
            // Sentry. Fall back to the Prisma not-found check otherwise.
            shouldBeCaptured: isLikeShelfError(cause)
              ? cause.shouldBeCaptured
              : !isNotFoundError(cause),
          });
        });

        if (isSelfService && teamMember.userId !== userId) {
          throw new ShelfError({
            cause: null,
            title: "Action not allowed",
            message: "Self user can only assign custody to themselves only.",
            additionalData: { userId, kitIds, custodian },
            label: "Kit",
            status: 403,
            shouldBeCaptured: false,
          });
        }

        await bulkAssignKitCustody({
          kitIds,
          custodianId: custodian.id,
          custodianName: custodian.name,
          organizationId,
          userId,
          currentSearchParams,
          allowedTeamMemberIds,
        });

        sendNotification({
          title: `Kits are now in custody of ${custodian.name}`,
          message:
            "Remember, these kits will be unavailable until it is manually checked in.",
          icon: { name: "success", variant: "success" },
          senderId: userId,
        });

        return data(payload({ success: true }));
      }

      case "bulk-release-custody": {
        const { kitIds } = parseData(formData, BulkReleaseKitCustodySchema);

        // The SELF_SERVICE "release only your own custody" check now lives in
        // `bulkReleaseKitCustody`, because it has to run on the RESOLVED kits.
        // Here it queried `kitCustody` with the raw `kitIds` — which is
        // `["all-selected"]` on a select-all, matching zero rows — so the
        // guard passed and every matched kit was released. Same shape as
        // `bulkCheckInAssets`, which already guards inside the service.
        await bulkReleaseKitCustody({
          userId,
          role,
          kitIds,
          organizationId,
          currentSearchParams,
          allowedTeamMemberIds,
        });

        sendNotification({
          title: "Kits are no longer in custody",
          message: "These kits are available again.",
          icon: { name: "success", variant: "success" },
          senderId: userId,
        });

        return data(payload({ success: true }));
      }

      case "bulk-update-location": {
        const { kitIds, newLocationId, currentSearchParams } = parseData(
          formData,
          KitBulkLocationUpdateSchema.and(CurrentSearchParamsSchema)
        );

        await bulkUpdateKitLocation({
          kitIds,
          organizationId,
          newLocationId,
          currentSearchParams,
          userId,
        });

        sendNotification({
          title: "Kits location updated",
          message: "These kits location has been updated successfully.",
          icon: { name: "success", variant: "success" },
          senderId: userId,
        });

        return data(payload({ success: true }));
      }

      default: {
        checkExhaustiveSwitch(intent);
        return data(payload(null));
      }
    }
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    return data(error(reason), { status: reason.status });
  }
}
