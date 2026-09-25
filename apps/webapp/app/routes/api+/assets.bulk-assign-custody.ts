import { data, type ActionFunctionArgs } from "react-router";
import { BulkAssignCustodySchema } from "~/components/assets/bulk-assign-custody-dialog";
import { db } from "~/database/db.server";
import { computeCustodyAvailability } from "~/modules/asset/availability-primitives.server";
import {
  bulkCheckOutAssets,
  checkOutQuantity,
} from "~/modules/asset/service.server";
import { CurrentSearchParamsSchema } from "~/modules/asset/utils.server";
import { getAssetIndexSettings } from "~/modules/asset-index-settings/service.server";
import {
  getTeamMember,
  scopeCustodianFilterIds,
} from "~/modules/team-member/service.server";
import { getClientHint } from "~/utils/client-hints";
import { resolveUserFormatPrefsById } from "~/utils/date-format.server";
import { sendNotification } from "~/utils/emitter/send-notification.server";
import {
  isLikeShelfError,
  isNotFoundError,
  makeShelfError,
  ShelfError,
} from "~/utils/error";
import { assertIsPost, payload, error, parseData } from "~/utils/http.server";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { requirePermission } from "~/utils/roles.server";

export async function action({ context, request }: ActionFunctionArgs) {
  const authSession = context.getSession();
  const userId = authSession.userId;

  try {
    assertIsPost(request);

    const { organizationId, role, canUseBarcodes, canSeeAllCustody } =
      await requirePermission({
        request,
        userId,
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

    const { assetIds, custodian, currentSearchParams, quantities } = parseData(
      formData,
      BulkAssignCustodySchema.and(CurrentSearchParamsSchema)
    );

    /**
     * Units per quantity-tracked asset, sent only by the scanner.
     *
     * Bulk custody skips quantity-tracked assets because selecting rows on the
     * assets index gives no way to say how many units each hand-over covers.
     * The scanner does: it shows one row per scan with its own quantity input.
     * So an asset named here is assigned through `checkOutQuantity`, the same
     * single-asset primitive the asset page uses, and the bulk call below never
     * sees it. An index submission sends no quantities and is unchanged.
     */
    /**
     * One entry per asset, not per scanned code.
     *
     * The scanner keys its rows by CODE, so an asset scanned through both its
     * QR and its barcode arrives twice under the same id. The per-unit writes
     * below run once per entry, so a duplicate would hand the quantity over
     * twice; the bulk path matches on an id set and is unaffected either way.
     * Duplicates carry no information (`quantities` holds one number per
     * asset), so collapsing them is lossless, and kinder than refusing a scan
     * where the operator did nothing wrong.
     */
    const uniqueAssetIds = [...new Set(assetIds)];

    const quantityAssetIds = uniqueAssetIds.filter((id) =>
      Object.prototype.hasOwnProperty.call(quantities, id)
    );
    const bulkAssetIds = uniqueAssetIds.filter(
      (id) => !Object.prototype.hasOwnProperty.call(quantities, id)
    );

    /**
     * Validate the custodian belongs to the same organization (early 404).
     * We don't keep the result around any more — the SELF_SERVICE
     * "assign-to-self" guard moved into `bulkCheckOutAssets` (web + mobile
     * share one implementation). The lookup here is still needed: it 404s
     * the request if the requested custodianId is from another org or
     * doesn't exist.
     */
    await getTeamMember({
      id: custodian.id,
      organizationId,
      select: { id: true },
    }).catch((cause) => {
      throw new ShelfError({
        cause,
        title: "Team member not found",
        message: "The selected team member could not be found.",
        additionalData: { userId, assetIds, custodian },
        label: "Assets",
        status: 404,
        // `getTeamMember` already classifies its errors — forward that
        // decision so DB / connectivity failures inside it still reach
        // Sentry. Fall back to the Prisma not-found check otherwise.
        shouldBeCaptured: isLikeShelfError(cause)
          ? cause.shouldBeCaptured
          : !isNotFoundError(cause),
      });
    });

    /**
     * The SELF_SERVICE "assign-to-self" guard lives inside the services
     * themselves: `bulkCheckOutAssets` for whole assets and
     * `checkOutQuantity` for the per-unit path, so web and mobile share one
     * source of truth. The route passes `role` through to both.
     */
    // Acting user's timezone: when "select all" is active the affected set is
    // resolved from the current date filters, which must truncate the day in
    // the user's tz (avoids an off-by-one for non-UTC users).
    const { timeZone } = await resolveUserFormatPrefsById(
      userId,
      getClientHint(request)
    );

    /**
     * Check the whole scan before writing any of it.
     *
     * Each `checkOutQuantity` call is its own transaction, so once one has
     * committed nothing puts it back. Without this pass, a scan whose third
     * asset is over-subscribed would leave the first two assigned while the
     * drawer reports the submission as failed, and a retry would then add
     * those two a second time, because the call increments an existing custody
     * row rather than setting it.
     *
     * This is a pre-flight, not a lock: each write re-checks availability
     * under its own row lock, which is what actually prevents over-allocation
     * if the pool moves in between. What the pre-flight buys is that the
     * refusal operators can actually provoke (asking for more than is free)
     * happens before anything is written.
     */
    const unavailable: string[] = [];
    for (const assetId of quantityAssetIds) {
      const asset = await db.asset.findFirst({
        where: { id: assetId, organizationId },
        select: { title: true, quantity: true },
      });

      if (!asset) continue; // `checkOutQuantity` refuses it by name.

      const { available } = await computeCustodyAvailability(db, {
        assetId,
        organizationId,
        totalQuantity: asset.quantity ?? 0,
      });

      if (quantities[assetId] > available) {
        unavailable.push(
          `"${asset.title}" (asked for ${quantities[assetId]}, ${available} free)`
        );
      }
    }

    if (unavailable.length) {
      throw new ShelfError({
        cause: null,
        title: "Not enough units available",
        message: `Nothing was assigned. ${unavailable.join("; ")}.`,
        additionalData: { unavailable },
        label: "Assets",
        status: 400,
        shouldBeCaptured: false,
      });
    }

    for (const assetId of quantityAssetIds) {
      await checkOutQuantity({
        assetId,
        teamMemberId: custodian.id,
        quantity: quantities[assetId],
        userId,
        organizationId,
        role,
      });
    }

    const { skippedQuantityTracked } = bulkAssetIds.length
      ? await bulkCheckOutAssets({
          userId,
          role,
          assetIds: bulkAssetIds,
          custodianId: custodian.id,
          custodianName: custodian.name,
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

    const skippedNote =
      skippedQuantityTracked > 0
        ? ` ${skippedQuantityTracked} quantity-tracked asset(s) were skipped. Assign custody individually.`
        : "";

    sendNotification({
      title: `Assets are now in custody of ${custodian.name}`,
      message: `Remember, these assets will be unavailable until custody is manually released.${skippedNote}`,
      icon: { name: "success", variant: "success" },
      senderId: userId,
    });

    return data(payload({ success: true }));
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    return data(error(reason), { status: reason.status });
  }
}
