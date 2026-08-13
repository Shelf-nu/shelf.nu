import { data, type ActionFunctionArgs } from "react-router";
import { z } from "zod";
import {
  requireMobileAuth,
  requireMobilePermission,
  requireOrganizationAccess,
  getMobileUserContext,
} from "~/modules/api/mobile-auth.server";
import { bulkCheckOutAssets } from "~/modules/asset/service.server";
import { getAssetIndexSettings } from "~/modules/asset-index-settings/service.server";
import { getTeamMember } from "~/modules/team-member/service.server";
import { makeShelfError, ShelfError } from "~/utils/error";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";

/**
 * POST /api/mobile/custody/assign
 *
 * Assigns custody of a single asset to a team member.
 * Uses the same `bulkCheckOutAssets` service as the webapp to ensure
 * consistent behavior (status updates, notes, validation).
 *
 * Body: { assetId: string, custodianId: string }
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
    const { assetId, custodianId } = z
      .object({
        assetId: z.string().min(1),
        custodianId: z.string().min(1),
      })
      .parse(body);

    // Get user context (role + barcode access) for asset index settings
    const { role, canUseBarcodes, canSeeAllCustody } =
      await getMobileUserContext(user.id, organizationId);

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
        additionalData: { userId: user.id, assetId, custodianId },
        label: "Assets",
        status: 404,
      });
    });

    await bulkCheckOutAssets({
      userId: user.id,
      role,
      assetIds: [assetId],
      custodianId,
      custodianName: teamMember.name,
      organizationId,
      currentSearchParams: "",
      settings,
      /**
       * Mobile sends no list filters (`currentSearchParams` is empty above), so
       * this never narrows anything today — the where-builder returns before it
       * is read. It still tracks the caller's real visibility so the day mobile
       * starts forwarding filters, a restricted user does not silently gain a
       * custodian filter. Swap in `scopeCustodianFilterIds` at that point, so
       * they can still filter by their OWN custody.
       */
      allowedTeamMemberIds: canSeeAllCustody ? "all" : [],
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
