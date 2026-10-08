import type { Prisma } from "@prisma/client";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { generateBulkSequentialIdsEfficient } from "~/modules/asset/sequential-id.server";
import { getSelectedOrganization } from "~/modules/organization/context.server";
import { updateOrganization } from "~/modules/organization/service.server";
import { getUserByID } from "~/modules/user/service.server";
import { makeShelfError } from "~/utils/error";
import { payload } from "~/utils/http.server";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { hasPermission } from "~/utils/permissions/permission.validator.server";

export async function action({ context, request }: ActionFunctionArgs) {
  const authSession = context.getSession();
  const { userId } = authSession;

  try {
    // Get the current organization
    const { organizationId } = await getSelectedOrganization({
      userId,
      request,
    });

    // The membership in this workspace only: the query filters on it.
    const user = await getUserByID(userId, {
      select: {
        id: true,
        userOrganizations: {
          where: { organizationId },
          select: { roles: true },
        },
      } satisfies Prisma.UserSelect,
    });

    // `userOrganizations` holds only this workspace's membership (filtered
    // above), so `[0]` is that membership, not a positional role read. The
    // migration rewrites every asset, so it follows `asset:update`.
    const canRunMigration = await hasPermission({
      organizationId,
      userId,
      roles: user.userOrganizations[0]?.roles ?? [],
      entity: PermissionEntity.asset,
      action: PermissionAction.update,
    });

    if (!canRunMigration) {
      return data(
        payload({
          success: false,
          message: "You don't have permission to run this migration.",
        }),
        { status: 403 }
      );
    }

    // Run the bulk sequential ID generation
    const updatedCount =
      await generateBulkSequentialIdsEfficient(organizationId);

    // Update the organization flag to mark migration as complete
    await updateOrganization({
      id: organizationId,
      userId,
      hasSequentialIdsMigrated: true,
    });

    // Handle different cases based on asset count
    const message =
      updatedCount === 0
        ? "Sequential IDs are now enabled! New assets will automatically get sequential IDs (SAM-0001, SAM-0002, etc.)"
        : `Successfully generated sequential IDs for ${updatedCount} assets`;

    return data(
      payload({
        success: true,
        updatedCount,
        message,
      })
    );
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    return data(
      payload({
        success: false,
        message: reason.message,
      }),
      { status: reason.status }
    );
  }
}
