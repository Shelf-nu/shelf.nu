import { AssetType } from "@prisma/client";
import { data, type ActionFunctionArgs } from "react-router";
import { BulkReleaseCustodySchema } from "~/components/assets/bulk-release-custody-dialog";
import { db } from "~/database/db.server";
import { bulkCheckInAssets } from "~/modules/asset/service.server";
import { CurrentSearchParamsSchema } from "~/modules/asset/utils.server";
import { getAssetIndexSettings } from "~/modules/asset-index-settings/service.server";
import {
  quantityRefusalsError,
  releaseQuantities,
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

    const { organizationId, role, canUseBarcodes, access } =
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
     * A caller whose scope is `self` may release only custody assigned to
     * them; checked here before delegating so a refused request does no
     * partial work. Custody is 1:many (several custodians on a
     * QUANTITY_TRACKED asset), so every row is checked.
     */
    if (access.custody.assign === "self") {
      const custodies = await db.custody.findMany({
        where: {
          assetId: { in: assetIds },
          asset: {
            organizationId,
            // Only the assets this release will actually touch.
            // `bulkCheckInAssets` skips QUANTITY_TRACKED rows — they are
            // released individually, with a quantity — and it reports the count
            // it skipped. Judging them here refuses the whole request over
            // custody nobody was going to release: a `self`-scoped caller
            // selecting their own individual asset alongside a qty-tracked one
            // that a colleague holds units of would get a 403 for the lot.
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
      custodyAssign: access.custody.assign,
      userId,
    });

    const { skippedQuantityTracked } = bulkAssetIds.length
      ? await bulkCheckInAssets({
          userId,
          custodyAssign: access.custody.assign,
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
            canSeeAllCustody: access.custody.seeAll,
            userId,
            organizationId,
          }),
        })
      : { skippedQuantityTracked: 0 };

    /**
     * The whole-asset call runs before the per-unit writes: it validates and
     * writes in one transaction, so if it refuses, nothing has been written.
     * The per-unit releases after it were checked above; a refusal there can
     * only come from a concurrent change, and is reported by asset.
     */
    const refusals = await releaseQuantities({
      releases: resolvedReleases,
      quantities,
      userId,
      organizationId,
      custodyAssign: access.custody.assign,
    });
    if (refusals.length) throw quantityRefusalsError("released", refusals);

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
