import { AssetType, OrganizationRoles } from "@prisma/client";
import { data, type ActionFunctionArgs } from "react-router";
import { BulkReleaseCustodySchema } from "~/components/assets/bulk-release-custody-dialog";
import { db } from "~/database/db.server";
import { bulkCheckInAssets } from "~/modules/asset/service.server";
import { CurrentSearchParamsSchema } from "~/modules/asset/utils.server";
import { getAssetIndexSettings } from "~/modules/asset-index-settings/service.server";
import { scopeCustodianFilterIds } from "~/modules/team-member/service.server";
import { getClientHint } from "~/utils/client-hints";
import { resolveUserFormatPrefsById } from "~/utils/date-format.server";
import { sendNotification } from "~/utils/emitter/send-notification.server";
import { makeShelfError, ShelfError } from "~/utils/error";
import { assertIsPost, payload, error, parseData } from "~/utils/http.server";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { requirePermission } from "~/utils/roles.server";

export async function action({ request, context }: ActionFunctionArgs) {
  const authSession = context.getSession();
  const userId = authSession.userId;

  try {
    assertIsPost(request);

    const { organizationId, role, canUseBarcodes, canSeeAllCustody } =
      await requirePermission({
        userId,
        request,
        entity: PermissionEntity.asset,
        action: PermissionAction.custody,
      });

    // Fetch asset index settings to determine mode
    const settings = await getAssetIndexSettings({
      userId,
      organizationId,
      canUseBarcodes,
      role,
    });

    const formData = await request.formData();

    const { assetIds, currentSearchParams } = parseData(
      formData,
      BulkReleaseCustodySchema.and(CurrentSearchParamsSchema)
    );

    /**
     * Phase 2 widened Custody from 1:1 to 1:many to support multi-custodian
     * QUANTITY_TRACKED assets. SELF_SERVICE users may only release custody
     * on rows assigned to their own user — guard before delegating to the
     * bulk service so we fail fast and don't leak counts via partial work.
     * Symmetric with the SELF_SERVICE assign-side guard centralised inside
     * `bulkCheckOutAssets` (see asset/service.server.ts).
     */
    if (role === OrganizationRoles.SELF_SERVICE) {
      const custodies = await db.custody.findMany({
        where: {
          assetId: { in: assetIds },
          asset: {
            organizationId,
            // Only the assets this release will actually touch.
            // `bulkCheckInAssets` skips QUANTITY_TRACKED rows — they are
            // released individually, with a quantity — and it reports the count
            // it skipped. Judging them here refuses the whole request over
            // custody nobody was going to release: a self-service user
            // selecting their own individual asset alongside a qty-tracked one
            // that a colleague holds units of got a 403 for the lot.
            type: { not: AssetType.QUANTITY_TRACKED },
          },
        },
        select: { custodian: { select: { id: true, userId: true } } },
      });

      if (custodies.some((custody) => custody.custodian.userId !== userId)) {
        throw new ShelfError({
          cause: null,
          title: "Action not allowed",
          message:
            "Self service user can only release custody of assets assigned to their user.",
          additionalData: { userId, assetIds },
          label: "Assets",
          status: 403,
          shouldBeCaptured: false,
        });
      }
    }

    // Acting user's timezone: when "select all" is active the affected set is
    // resolved from the current date filters, which must truncate the day in
    // the user's tz (avoids an off-by-one for non-UTC users).
    const { timeZone } = await resolveUserFormatPrefsById(
      userId,
      getClientHint(request)
    );

    const { skippedQuantityTracked } = await bulkCheckInAssets({
      userId,
      role,
      assetIds,
      organizationId,
      currentSearchParams,
      settings,
      timeZone,
      // `asset: custody` is a SELF_SERVICE permission, so narrow the
      // select-all custodian filter to the caller's own custody — otherwise a
      // self-service user could act on exactly the set a colleague holds.
      allowedTeamMemberIds: await scopeCustodianFilterIds({
        teamMemberIds: new URLSearchParams(currentSearchParams ?? "").getAll(
          "teamMember"
        ),
        canSeeAllCustody,
        userId,
        organizationId,
      }),
    });

    const skippedNote =
      skippedQuantityTracked > 0
        ? ` ${skippedQuantityTracked} quantity-tracked asset(s) were skipped — release custody individually.`
        : "";

    sendNotification({
      title: "Assets are no longer in custody",
      message: `These assets are available again.${skippedNote}`,
      icon: { name: "success", variant: "success" },
      senderId: userId,
    });

    return data(payload({ success: true }));
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    return data(error(reason), { status: reason.status });
  }
}
