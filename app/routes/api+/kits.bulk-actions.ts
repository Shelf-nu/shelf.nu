import { OrganizationRoles } from "@prisma/client";
import { json, type ActionFunctionArgs } from "@remix-run/node";
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
import { getTeamMember } from "~/modules/team-member/service.server";
import { checkExhaustiveSwitch } from "~/utils/check-exhaustive-switch";
import { sendNotification } from "~/utils/emitter/send-notification.server";
import { makeShelfError, ShelfError } from "~/utils/error";
import { data, error, parseData } from "~/utils/http.server";
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

    const { organizationId, role } = await requirePermission({
      userId,
      request,
      entity: PermissionEntity.kit,
      action: intent2ActionMap[intent],
    });
    const isSelfService = role === OrganizationRoles.SELF_SERVICE;

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

        return json(data({ success: true }));
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
          });
        });

        if (isSelfService && teamMember.userId !== userId) {
          throw new ShelfError({
            cause: null,
            title: "Action not allowed",
            message: "Self user can only assign custody to themselves only.",
            additionalData: { userId, kitIds, custodian },
            label: "Kit",
          });
        }

        await bulkAssignKitCustody({
          kitIds,
          custodianId: custodian.id,
          custodianName: custodian.name,
          organizationId,
          userId,
          currentSearchParams,
        });

        sendNotification({
          title: `Kits are now in custody of ${custodian.name}`,
          message:
            "Remember, these kits will be unavailable until it is manually checked in.",
          icon: { name: "success", variant: "success" },
          senderId: userId,
        });

        return json(data({ success: true }));
      }

      case "bulk-release-custody": {
        const { kitIds } = parseData(formData, BulkReleaseKitCustodySchema);

        if (isSelfService) {
          const custodies = await db.kitCustody.findMany({
            where: { kitId: { in: kitIds } },
            select: { custodian: { select: { id: true, userId: true } } },
          });

          if (
            custodies.some((custody) => custody.custodian.userId !== userId)
          ) {
            throw new ShelfError({
              cause: null,
              title: "Action not allowed",
              message: "Self user can release custody of themselves only.",
              additionalData: { userId, kitIds },
              label: "Kit",
            });
          }
        }

        await bulkReleaseKitCustody({
          userId,
          kitIds,
          organizationId,
          currentSearchParams,
        });

        sendNotification({
          title: "Kits are no longer in custody",
          message: "These kits are available again.",
          icon: { name: "success", variant: "success" },
          senderId: userId,
        });

        return json(data({ success: true }));
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

        return json(data({ success: true }));
      }

      default: {
        checkExhaustiveSwitch(intent);
        return json(data(null));
      }
    }
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    return json(error(reason), { status: reason.status });
  }
}
