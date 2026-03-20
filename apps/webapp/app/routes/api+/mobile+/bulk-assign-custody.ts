import { data, type ActionFunctionArgs } from "react-router";
import { z } from "zod";
import {
  requireMobileAuth,
  requireMobilePermission,
  requireOrganizationAccess,
  getMobileUserContext,
} from "~/modules/api/mobile-auth.server";
import { bulkAssignCustody } from "~/modules/asset/service.server";
import { getAssetIndexSettings } from "~/modules/asset-index-settings/service.server";
import { getTeamMember } from "~/modules/team-member/service.server";
import { makeShelfError, ShelfError } from "~/utils/error";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";

/**
 * POST /api/mobile/bulk-assign-custody
 *
 * Assigns custody of multiple assets to a team member.
 * Uses the same `bulkAssignCustody` service as the webapp to ensure
 * consistent behavior (status updates, notes, validation).
 *
 * Body: { assetIds: string[], custodianId: string }
 */
export async function action({ request }: ActionFunctionArgs) {
  let userId: string | undefined;

  try {
    const { user } = await requireMobileAuth(request);
    userId = user.id;

    const organizationId = await requireOrganizationAccess(request, user.id);

    // RBAC: require asset:custody permission
    await requireMobilePermission({
      userId: user.id,
      organizationId,
      entity: PermissionEntity.asset,
      action: PermissionAction.custody,
    });

    const body = await request.json();
    const { assetIds, custodianId } = z
      .object({
        assetIds: z.array(z.string().min(1)).min(1),
        custodianId: z.string().min(1),
      })
      .parse(body);

    // Get user context (role + barcode access) for asset index settings
    const { role, canUseBarcodes } = await getMobileUserContext(
      user.id,
      organizationId
    );

    const settings = await getAssetIndexSettings({
      userId: user.id,
      organizationId,
      canUseBarcodes,
      role,
    });

    // Validate custodian belongs to the organization
    const teamMember = await getTeamMember({
      id: custodianId,
      organizationId,
      select: { id: true, name: true },
    }).catch((cause) => {
      throw new ShelfError({
        cause,
        title: "Team member not found",
        message: "The selected team member could not be found.",
        additionalData: { userId: user.id, assetIds, custodianId },
        label: "Assets",
        status: 404,
      });
    });

    await bulkAssignCustody({
      userId: user.id,
      assetIds,
      custodianId,
      custodianName: teamMember.name,
      organizationId,
      currentSearchParams: "",
      settings,
    });

    return data({ success: true });
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    return data(
      { error: { message: reason.message } },
      { status: reason.status }
    );
  }
}
