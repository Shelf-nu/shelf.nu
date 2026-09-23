import { OrganizationRoles } from "@prisma/client";
import { data, type ActionFunctionArgs } from "react-router";
import { BulkReleaseCustodySchema } from "~/components/assets/bulk-release-custody-dialog";
import { db } from "~/database/db.server";
import {
  bulkCheckInAssets,
  releaseQuantity,
} from "~/modules/asset/service.server";
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

    const { assetIds, currentSearchParams, quantities } = parseData(
      formData,
      BulkReleaseCustodySchema.and(CurrentSearchParamsSchema)
    );

    /**
     * Units per quantity-tracked asset, sent only by the scanner — see the
     * field's note on `BulkReleaseCustodySchema`. Named assets are released
     * through `releaseQuantity`, the same primitive the asset page uses, and
     * never reach the bulk call. An index submission sends none, so its
     * behaviour is unchanged.
     */
    const quantityAssetIds = assetIds.filter((id) =>
      Object.prototype.hasOwnProperty.call(quantities, id)
    );
    const bulkAssetIds = assetIds.filter(
      (id) => !Object.prototype.hasOwnProperty.call(quantities, id)
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
          asset: { organizationId },
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

    /**
     * Releasing needs a custodian, and this scanner never asks for one — a
     * bulk release takes the asset back from whoever holds it. For a
     * quantity-tracked asset that is only unambiguous while one person holds
     * it, so the single holder is resolved here and anything else is refused
     * by name rather than guessed at. Splitting a release across custodians is
     * what the asset's own custody list is for.
     *
     * Only operator-assigned rows are candidates: a `Custody` row carrying a
     * `kitCustodyId` was inherited from the kit and goes back by releasing the
     * kit, which cascade-deletes it.
     *
     * Every holder is resolved before any release runs, because each
     * `releaseQuantity` call commits its own transaction — resolving inside
     * the write loop would let a refusal on a later asset leave earlier ones
     * already released while the drawer reports the whole submission failed.
     */
    /** One resolved `{ assetId, teamMemberId }` per quantity-tracked scan. */
    const resolvedReleases: { assetId: string; teamMemberId: string }[] = [];

    if (quantityAssetIds.length) {
      const custodyRows = await db.custody.findMany({
        where: {
          assetId: { in: quantityAssetIds },
          kitCustodyId: null,
          asset: { organizationId },
        },
        select: {
          assetId: true,
          teamMemberId: true,
          asset: { select: { title: true } },
        },
      });

      for (const assetId of quantityAssetIds) {
        const holders = custodyRows.filter((row) => row.assetId === assetId);

        if (holders.length !== 1) {
          throw new ShelfError({
            cause: null,
            status: 400,
            label: "Assets",
            shouldBeCaptured: false,
            message:
              holders.length === 0
                ? "This asset has no units in anyone's custody to release."
                : `"${holders[0].asset.title}" is held by more than one person. Release it from the asset's custody list, where each holder is listed separately.`,
            additionalData: { assetId, holders: holders.length },
          });
        }

        resolvedReleases.push({
          assetId,
          teamMemberId: holders[0].teamMemberId,
        });
      }
    }

    for (const { assetId, teamMemberId } of resolvedReleases) {
      await releaseQuantity({
        assetId,
        teamMemberId,
        quantity: quantities[assetId],
        userId,
        organizationId,
      });
    }

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
          // select-all custodian filter to the caller's own custody — otherwise a
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
