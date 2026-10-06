/**
 * POST /api/mobile/custody/release-quantity
 *
 * Ends a team member's hold on N units of a QUANTITY_TRACKED asset. Mobile twin
 * of the web's `/api/assets/release-quantity-custody` route: same Zod schema,
 * same SELF_SERVICE guard, and the same `releaseQuantityFromCustodian` call
 * (the release, its audit note and the low-stock check).
 *
 * **What happens to the units is decided server-side** from the asset's
 * `consumptionType` (see `releaseCategory` in `@shelf/quantity-control`), with
 * an optional operator-supplied split:
 *
 * - `RETURN` (`TWO_WAY`, and legacy rows with no `consumptionType`) — the units
 *   go back into the available pool and `Asset.quantity` is untouched. These
 *   assets reject a non-zero `consumed`.
 * - `CONSUME` (`ONE_WAY` consumables) — the units default to used-up, so
 *   `Asset.quantity` is permanently decremented. A `consumed` field below the
 *   released quantity hands the remainder back instead.
 *
 * The audit note is worded from the split the service reports back, so what the
 * operator reads always matches what was persisted.
 *
 * Runs the debounced low-stock notifier (best-effort) after every release.
 * Available stock is `Asset.quantity - SUM(Custody.quantity)`: ending a hold
 * drops custody by the full release and total by the consumed part, so
 * available rises by exactly the RETURNED units — and is unchanged when
 * everything was consumed. The notifier still runs so a recovery clears the
 * now-stale debounce marker and sends the recovery notice, or the next genuine
 * alert is suppressed. Mirrors the web route.
 *
 * Body: { assetId: string, teamMemberId: string, quantity: number, consumed?: number, note?: string }
 * Org: `?orgId=` query param or `x-shelf-organization` header.
 *
 * Success envelope: `{ success: true, asset }` where `asset` is the
 * refreshed asset shaped for mobile (custody visibility already filtered
 * for the caller) so the app can update state without a second round trip.
 *
 * @see {@link file://./../assets.release-quantity-custody.ts} — the mirrored web route
 * @see {@link file://./../../../modules/custody/quantity-custody.server.ts} releaseQuantityFromCustodian
 * @see {@link file://./custody.assign-quantity.ts} — counterpart assign route
 */

import { OrganizationRoles } from "@prisma/client";
import { data, type ActionFunctionArgs } from "react-router";
import { z } from "zod";
import {
  getMobileAssetForViewer,
  getMobileUserContext,
  requireMobileAuth,
  requireMobilePermission,
  requireOrganizationAccess,
} from "~/modules/api/mobile-auth.server";
import {
  QUANTITY_CUSTODIAN_SELECT,
  releaseQuantityFromCustodian,
} from "~/modules/custody/quantity-custody.server";
import { getTeamMember } from "~/modules/team-member/service.server";
import { makeShelfError, ShelfError } from "~/utils/error";
import { Logger } from "~/utils/logger";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { enforceUserRateLimit } from "~/utils/rate-limit.server";

/**
 * Zod schema for the release-quantity-custody JSON body. Identical to the
 * web's `ReleaseQuantityCustodySchema` (assets.release-quantity-custody.ts).
 */
const ReleaseQuantityCustodySchema = z.object({
  assetId: z.string().min(1, "Asset ID is required"),
  teamMemberId: z.string().min(1, "Team member is required"),
  quantity: z.coerce
    .number()
    .int()
    .positive("Quantity must be a positive integer"),
  /**
   * How many of the released units were used up. Optional: when absent the
   * server derives it from the asset's consumptionType. Only a consumable
   * accepts a non-zero value, which the service enforces.
   */
  consumed: z.coerce.number().int().nonnegative().optional(),
  note: z
    .string()
    .optional()
    .transform((val) => (val === "" ? undefined : val)),
  /**
   * Release only the units taken from this source: a location id,
   * `null` / `""` for the unplaced units, or `"unrecorded"` for units whose
   * source was never recorded (a `sources` entry with `unrecorded: true`).
   * Optional and additive: an app
   * build that does not send it has the holder's rows drawn in the
   * service's fixed order.
   */
  locationId: z.string().nullable().optional(),
});

export async function action({ request }: ActionFunctionArgs) {
  let userId: string | undefined;

  try {
    const { user } = await requireMobileAuth(request);
    userId = user.id;
    // Same limiter bucket as the other mobile custody mutations — a stuck
    // retry loop or rapid taps shouldn't hammer a row-locking transaction.
    await enforceUserRateLimit(user.id, "bulk");

    const organizationId = await requireOrganizationAccess(request, user.id);

    // RBAC: require asset:custody permission (SELF_SERVICE passes, BASE 403s
    // — same Role2PermissionMap as the web quantity routes)
    await requireMobilePermission({
      userId: user.id,
      organizationId,
      entity: PermissionEntity.asset,
      action: PermissionAction.custody,
    });

    // Role for the SELF_SERVICE guard below; canSeeAllCustody for shaping
    // the refreshed asset. No getAssetIndexSettings here: releaseQuantity
    // takes no `settings` param (that call is bulk-route plumbing only).
    const { role, canSeeAllCustody } = await getMobileUserContext(
      user.id,
      organizationId
    );

    // why: siblings use raw `.parse`, which surfaces a ZodError as a 500
    // through makeShelfError's unknown-error branch. The web route returns
    // 400 via parseData — safeParse + a 400 ShelfError honors that parity.
    // An unreadable body parses as `null` and fails the schema too, so it
    // takes the same 400 instead of throwing a SyntaxError into the 500 branch.
    const parsed = ReleaseQuantityCustodySchema.safeParse(
      await request.json().catch(() => null)
    );
    if (!parsed.success) {
      throw new ShelfError({
        cause: parsed.error,
        message: "Invalid request body",
        additionalData: { validationErrors: parsed.error.flatten() },
        label: "Assets",
        status: 400,
        shouldBeCaptured: false,
      });
    }
    const { assetId, teamMemberId, quantity, consumed, note, locationId } =
      parsed.data;

    /**
     * Validate that the team member belongs to the same organization.
     * The web release route omits the `.catch` wrapper (getTeamMember's own
     * error is already a 404 "Team member not found"); mobile standardizes
     * on the wrapped form used by every sibling — same surfaced 404.
     */
    const teamMember = await getTeamMember({
      id: teamMemberId,
      organizationId,
      select: { ...QUANTITY_CUSTODIAN_SELECT, userId: true },
    }).catch((cause) => {
      throw new ShelfError({
        cause,
        title: "Team member not found",
        message: "The selected team member could not be found.",
        additionalData: { userId: user.id, assetId, teamMemberId },
        label: "Assets",
        status: 404,
      });
    });

    /** Self-service users can only release their own custody */
    if (
      role === OrganizationRoles.SELF_SERVICE &&
      teamMember.userId !== user.id
    ) {
      throw new ShelfError({
        cause: null,
        title: "Action not allowed",
        message: "Self-service users can only release their own custody.",
        additionalData: { userId: user.id, assetId, teamMemberId },
        label: "Assets",
        status: 403,
        shouldBeCaptured: false,
      });
    }

    /**
     * `releaseQuantityFromCustodian` writes the release (validated under a row
     * lock by `releaseQuantity`; kit-allocated custody rows are not releasable
     * here, only the operator row), then the audit note worded from the split
     * the service persisted, then the low-stock check. App builds that predate
     * `consumed` omit it and keep the server-derived outcome.
     */
    await releaseQuantityFromCustodian({
      assetId,
      custodian: teamMember,
      quantity,
      consumed,
      userId: user.id,
      organizationId,
      role,
      note,
      locationId,
    });

    // No route-level sendNotification success toast here: that's the web's
    // SSE emitter and mobile has no listener (matches custody.release.ts).

    // Refreshed asset, shaped for mobile with the caller's custody
    // visibility already applied, so the app can update state directly.
    // Best-effort: releaseQuantity has already committed, so a refresh
    // failure must NOT surface as an action error — the client would show
    // a failure (and could retry the non-idempotent release) for a release
    // that actually succeeded. Null on failure; the app refetches anyway.
    let asset = null;
    try {
      asset = await getMobileAssetForViewer({
        assetId,
        organizationId,
        viewerUserId: user.id,
        canSeeAllCustody,
      });
    } catch (refreshError) {
      Logger.error(
        new ShelfError({
          cause: refreshError,
          message: "Failed to refresh asset after quantity release",
          label: "Assets",
          additionalData: { assetId, userId: user.id },
        })
      );
    }

    return data({ success: true, asset });
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    return data(
      { error: { message: reason.message } },
      { status: reason.status }
    );
  }
}
