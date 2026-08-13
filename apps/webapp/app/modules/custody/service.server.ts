import type { Asset, User } from "@prisma/client";
import { AssetStatus, OrganizationRoles } from "@prisma/client";
import { db } from "~/database/db.server";
import { recordEvent } from "~/modules/activity-event/service.server";
import { ShelfError } from "~/utils/error";
import { releaseAssetsToAvailableUnlessCheckedOut } from "../asset/custody-status.server";

/**
 * Releases all custody for an asset, setting its status to AVAILABLE unless it
 * is checked out on a booking.
 *
 * **INDIVIDUAL assets only.** The `deleteMany` below releases ALL custodians at
 * once, which is exactly one row for an INDIVIDUAL asset and every custodian's
 * row for a `QUANTITY_TRACKED` one. QT releases belong to `releaseQuantity()`
 * in the asset service, which takes a quantity and releases one custodian's
 * slice. Both callers enforce the contract with `isQuantityTracked` before
 * calling in, so the delete is deliberately NOT scoped to a single custodian —
 * scoping it would be dead code on the only shape that reaches here, and would
 * make the SELF_SERVICE path silently diverge from the ADMIN one.
 *
 * @param assetId - The ID of the asset to release custody from
 * @param organizationId - The organization ID
 * @param userId - The caller's user ID (for the SELF_SERVICE self-restriction)
 * @param role - The caller's role; SELF_SERVICE may only release their own custody
 * @param activityEvent - Optional activity event data for audit trail
 *   (records `CUSTODY_RELEASED` atomically when provided)
 */
export async function releaseCustody({
  assetId,
  organizationId,
  userId,
  role,
  activityEvent,
}: {
  assetId: Asset["id"];
  organizationId: Asset["organizationId"];
  userId: User["id"];
  /**
   * Caller's role. Required so the SELF_SERVICE self-restriction is enforced
   * here for EVERY caller (web + mobile), not duplicated in each route.
   */
  role: OrganizationRoles;
  /** Optional activity event data - if provided, records CUSTODY_RELEASED event atomically */
  activityEvent?: {
    actorUserId: string;
    teamMemberId?: string;
    targetUserId?: string;
  };
}) {
  try {
    // Wrap in a transaction so the custody release + activity event
    // commit atomically (main's pattern). Use `deleteMany` (not
    // `delete`) so QUANTITY_TRACKED assets release ALL custodians
    // at once — Phase 2 changed `Asset.custody` from `Custody?` to
    // `Custody[]`, so `delete: true` no longer compiles.
    return await db.$transaction(async (tx) => {
      /**
       * Self-service users may only release custody assigned to them.
       *
       * Read INSIDE the transaction: a check before it is a TOCTOU gap in the
       * authorization itself — custody reassigned between the read and the
       * delete would let a self-service user release a custodian that is no
       * longer theirs. Same reasoning as the status guard below, applied to
       * the permission rather than the column.
       *
       * The catch at the bottom rethrows `ShelfError` untouched, so this 403
       * still reaches the user as itself rather than as the generic message.
       */
      if (role === OrganizationRoles.SELF_SERVICE) {
        const current = await tx.custody.findFirst({
          where: { assetId, asset: { organizationId } },
          select: { custodian: { select: { userId: true } } },
        });

        if (current?.custodian?.userId !== userId) {
          throw new ShelfError({
            cause: null,
            title: "Action not allowed",
            message:
              "Self service user can only release custody of assets assigned to their user.",
            additionalData: { userId, assetId },
            label: "Custody",
            status: 403,
            shouldBeCaptured: false,
          });
        }
      }

      /**
       * Split into delete → guarded status write → re-read.
       *
       * A single `asset.update` with a nested `custody: { deleteMany: {} }`
       * cannot express "set AVAILABLE unless CHECKED_OUT" — `update` has no
       * conditional `where` beyond identity. Releasing the last custody row on
       * an asset still out on a booking therefore advertised a physically
       * absent asset as free, which is the more dangerous half of the
       * precedence this PR restores. Assets already in that state predate the
       * fix, so the assign-side 400 does not cover them.
       *
       * @see {@link file://./../asset/custody-status.server.ts}
       */
      await tx.custody.deleteMany({ where: { assetId } });

      await releaseAssetsToAvailableUnlessCheckedOut(
        tx,
        [assetId],
        organizationId
      );

      // Re-read so callers keep the shape they build the activity note from.
      // `findUniqueOrThrow` rather than the update's return value: the status
      // write above is conditional, so only the row itself is authoritative.
      const asset = await tx.asset.findUniqueOrThrow({
        where: { id: assetId, organizationId },
        include: {
          user: {
            select: {
              firstName: true,
              lastName: true,
              displayName: true,
            },
          },
          custody: true,
        },
      });

      // Record activity event if actor data is provided
      if (activityEvent) {
        await recordEvent(
          {
            organizationId,
            actorUserId: activityEvent.actorUserId,
            action: "CUSTODY_RELEASED",
            entityType: "ASSET",
            entityId: assetId,
            assetId,
            teamMemberId: activityEvent.teamMemberId,
            targetUserId: activityEvent.targetUserId,
          },
          tx
        );
      }

      return asset;
    });
  } catch (cause) {
    // Deliberate, user-facing failures (the SELF_SERVICE 403 above) must
    // survive this wrapper. `ShelfError` inherits `title` and `status` from its
    // cause but ALWAYS assigns its own `message`, and the routes render
    // `error.message` — so wrapping would swap the specific instruction for the
    // generic one and the user would never learn why the release was refused.
    if (cause instanceof ShelfError) {
      throw cause;
    }

    throw new ShelfError({
      cause,
      message:
        "Something went wrong while releasing the custody. Please try again or contact support.",
      additionalData: { assetId },
      label: "Custody",
    });
  }
}
