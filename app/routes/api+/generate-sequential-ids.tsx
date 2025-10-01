import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { generateBulkSequentialIdsEfficient } from "~/modules/asset/sequential-id.server";
import { getSelectedOrganisation } from "~/modules/organization/context.server";
import { updateOrganization } from "~/modules/organization/service.server";
import { getUserByID } from "~/modules/user/service.server";
import { makeShelfError } from "~/utils/error";

export async function action({ context, request }: ActionFunctionArgs) {
  const authSession = context.getSession();
  const { userId } = authSession;

  try {
    // Get the current organization
    const { organizationId } = await getSelectedOrganisation({
      userId,
      request,
    });

    // Verify user has permission (owner or admin in org)
    const user = await getUserByID(userId, {
      select: {
        id: true,
        userOrganizations: {
          where: { organizationId },
          select: { roles: true },
        },
      },
    });

    const userRoles = user.userOrganizations[0]?.roles || [];
    const canRunMigration =
      userRoles.includes("OWNER") || userRoles.includes("ADMIN");

    if (!canRunMigration) {
      return json(
        {
          success: false,
          message: "You don't have permission to run this migration.",
        },
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

    return json({
      success: true,
      updatedCount,
      message,
    });
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    return json(
      {
        success: false,
        message: reason.message,
      },
      { status: reason.status }
    );
  }
}
