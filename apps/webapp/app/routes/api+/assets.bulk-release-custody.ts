import { AssetType, OrganizationRoles } from "@prisma/client";
import { data, type ActionFunctionArgs } from "react-router";
import { BulkReleaseCustodySchema } from "~/components/assets/bulk-release-custody-dialog";
import { db } from "~/database/db.server";
import { bulkCheckInAssets } from "~/modules/asset/service.server";
import { CurrentSearchParamsSchema } from "~/modules/asset/utils.server";
import { getAssetIndexSettings } from "~/modules/asset-index-settings/service.server";
import {
  releaseQuantityFromCustodian,
  resolveQuantityReleases,
  splitQuantityAssetIds,
} from "~/modules/custody/quantity-custody.server";
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

    const { assetIds, currentSearchParams, quantities } = parseData(
      formData,
      BulkReleaseCustodySchema.and(CurrentSearchParamsSchema)
    );

    /**
     * Units per quantity-tracked asset, sent only by the scanner. See the
     * field's note on `BulkReleaseCustodySchema`. Named assets are released
     * unit by unit, the way the asset page does it, and never reach the bulk
     * call. An index submission sends none, so its behaviour is unchanged.
     */
    const { quantityAssetIds, bulkAssetIds } = splitQuantityAssetIds(
      assetIds,
      quantities
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

    // Each per-unit release is resolved to its single holder and checked
    // before anything is written.
    const resolvedReleases = await resolveQuantityReleases({
      quantityAssetIds,
      quantities,
      organizationId,
    });

    const { skippedQuantityTracked } = bulkAssetIds.length
      ? await bulkCheckInAssets({
          userId,
          role,
          assetIds: bulkAssetIds,
          organizationId,
          currentSearchParams,
          settings,
          timeZone,
          // `asset: custody` is a SELF_SERVICE permission, so narrow the
          // select-all custodian filter to the caller's own custody, otherwise a
          // self-service user could act on exactly the set a colleague holds.
          allowedTeamMemberIds: await scopeCustodianFilterIds({
            teamMemberIds: new URLSearchParams(
              currentSearchParams ?? ""
            ).getAll("teamMember"),
            canSeeAllCustody,
            userId,
            organizationId,
          }),
        })
      : { skippedQuantityTracked: 0 };

    /**
     * The whole-asset path runs first, and the per-unit writes after it.
     *
     * Neither service joins the other's transaction (each opens its own), so
     * a mixed submission cannot be made all-or-nothing without reworking
     * primitives that four other custody routes depend on, and holding their
     * row locks across a whole scan. What the order buys is that the operation
     * which can still refuse mid-flight goes first: every quantity release
     * below has already been checked against its holder and their units by the
     * pass above, while `bulkCheckInAssets` validates its own set as it runs.
     */
    for (const { assetId, custodian } of resolvedReleases) {
      await releaseQuantityFromCustodian({
        assetId,
        custodian,
        quantity: quantities[assetId],
        userId,
        organizationId,
        role,
      });
    }

    const skippedNote =
      skippedQuantityTracked > 0
        ? ` ${skippedQuantityTracked} quantity-tracked asset(s) were skipped. Release custody individually.`
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
