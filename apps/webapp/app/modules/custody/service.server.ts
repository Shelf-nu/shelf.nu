import type { Asset, User } from "@prisma/client";
import { AssetType, Prisma } from "@prisma/client";
import {
  KIT_MEMBER_CUSTODY_BLOCKED_TITLE,
  kitMembersCustodyRefusal,
} from "@shelf/labels";
import { db } from "~/database/db.server";
import { recordEvent } from "~/modules/activity-event/service.server";
import { ShelfError } from "~/utils/error";
import type { RoleAccess } from "~/utils/permissions/role-access";
import { releaseAssetsToAvailableUnlessCheckedOut } from "../asset/custody-status.server";

/**
 * Refuses to release custody rows that a kit put there.
 *
 * A `Custody` row with `kitCustodyId` set exists because the asset's KIT is in
 * custody; the kit is the source of truth for it, and releasing the kit is what
 * removes it (the FK cascades). Deleting such a row directly makes the member
 * read "Available" while the kit still names a custodian — the system would
 * give two answers to "who has this?".
 *
 * Call it AFTER the caller's own (kit-scoped-away) delete, inside the same
 * transaction. The delete never touches kit-derived rows, so a row that exists
 * by the time this read runs is still there to be found, and aborts the whole
 * transaction rather than being silently deleted.
 *
 * It does NOT serialise against a kit assignment. Under READ COMMITTED — the
 * default here, with no row lock — a kit custody row committed after this read
 * is invisible to it, and the caller goes on to mark the asset AVAILABLE (or
 * take custody of it) beside a live KitCustody. Closing that needs a
 * `SELECT … FOR UPDATE` on the asset; what this guard rules out is the far
 * likelier case of a kit-derived row that already existed.
 *
 * @param tx - the active transaction the release runs in
 * @param assetIds - assets about to have their custody rows deleted
 * @param organizationId - proves org ownership of the rows being checked
 * @throws {ShelfError} 400 when any custody on these assets is kit-derived
 */
export async function assertNoKitDerivedCustody(
  tx: Pick<typeof db, "custody">,
  assetIds: Asset["id"][],
  organizationId: Asset["organizationId"]
) {
  const kitDerived = await tx.custody.findFirst({
    where: {
      assetId: { in: assetIds },
      asset: { organizationId },
      kitCustodyId: { not: null },
    },
    select: { assetId: true },
  });

  if (kitDerived) {
    throw new ShelfError({
      cause: null,
      title: "Custody is managed by the kit",
      message:
        "This asset is in custody because its kit is. Release the kit's custody instead.",
      additionalData: { assetId: kitDerived.assetId, organizationId },
      label: "Custody",
      status: 400,
      shouldBeCaptured: false,
    });
  }
}

/** Row-lock strengths {@link lockAssetRows} takes. A closed set: it is spliced into SQL. */
type AssetRowLockMode = "FOR UPDATE" | "FOR KEY SHARE";

/**
 * Locks the given asset rows, in id order, in the caller's workspace.
 *
 * The custody assign guard and the kit-membership insert both lock through
 * this one query, so they always take their locks in the same order. That
 * shared order is what keeps them from deadlocking: keep the `ORDER BY` and
 * the workspace filter here, never in a copy.
 *
 * The ids travel as one array parameter (`= ANY`), so a "select all" over any
 * number of assets stays within Postgres's bind-parameter limit.
 *
 * @param tx - the active transaction the lock is held for
 * @param assetIds - assets to lock (request input; rows in other workspaces are skipped)
 * @param organizationId - the caller's workspace
 * @param mode - `FOR UPDATE` on the custody side, `FOR KEY SHARE` on the kit side
 */
async function lockAssetRows(
  tx: Pick<typeof db, "$queryRaw">,
  assetIds: Asset["id"][],
  organizationId: Asset["organizationId"],
  mode: AssetRowLockMode
) {
  if (assetIds.length === 0) return;

  // Column names are literal: `Asset` declares no `@map`.
  // @see .claude/rules/raw-sql-respects-prisma-map.md
  await tx.$queryRaw(Prisma.sql`
    SELECT "id" FROM "Asset"
    WHERE "id" = ANY(${assetIds}::text[]) AND "organizationId" = ${organizationId}
    ORDER BY "id"
    ${Prisma.raw(mode)}
  `);
}

/**
 * Refuses to put an individually tracked kit member into custody on its own,
 * without taking any lock.
 *
 * Custody of an asset that belongs to a kit comes from the kit: assign custody
 * to the kit, or take the asset out of the kit first. Both scanners already
 * refuse such an asset; this is the server-side rule every assign path calls,
 * so no request can reach a state the scanners would refuse.
 *
 * `QUANTITY_TRACKED` assets are not refused. A kit holds only a slice of a
 * pool, and the units outside every kit can still be assigned on their own.
 *
 * Release is not covered and must not be: custody rows written before this
 * rule existed stay releasable.
 *
 * This is the read on its own, for pages that only decide whether to open (the
 * assign page's loader). Anything that goes on to write custody must call
 * {@link assertNotKitMembers}, which locks first.
 *
 * @param reader - the client or transaction to read through
 * @param assetIds - assets about to be put into custody (request input)
 * @param organizationId - the caller's workspace; memberships in any other
 *   workspace are ignored
 * @throws {ShelfError} 400 giving the number of kit members and naming the
 *   first few
 */
export async function refuseKitMembers(
  reader: Pick<typeof db, "assetKit">,
  assetIds: Asset["id"][],
  organizationId: Asset["organizationId"]
) {
  if (assetIds.length === 0) return;

  const memberships = await reader.assetKit.findMany({
    where: {
      assetId: { in: assetIds },
      organizationId,
      asset: { type: AssetType.INDIVIDUAL },
    },
    select: {
      asset: { select: { id: true, title: true } },
      kit: { select: { id: true, name: true } },
    },
    orderBy: { asset: { title: "asc" } },
  });

  if (memberships.length === 0) return;

  throw new ShelfError({
    cause: null,
    title: KIT_MEMBER_CUSTODY_BLOCKED_TITLE,
    message: kitMembersCustodyRefusal(
      memberships.map((m) => ({
        assetTitle: m.asset.title,
        kitName: m.kit.name,
      }))
    ),
    additionalData: {
      assetIds: memberships.map((m) => m.asset.id),
      kitIds: [...new Set(memberships.map((m) => m.kit.id))],
      organizationId,
    },
    label: "Custody",
    status: 400,
    shouldBeCaptured: false,
  });
}

/**
 * Locks the asset rows, then refuses kit members ({@link refuseKitMembers}).
 * Every path that writes custody calls this one.
 *
 * Call it inside the assign transaction, before ANY write to the asset rows
 * (the status claim included) and before the custody rows, so the refusal rolls
 * back anything the transaction already did.
 *
 * It serialises against adding the same asset to a kit. It first takes
 * `FOR UPDATE` on the asset rows, which an `AssetKit` insert has to wait for
 * (the insert's foreign-key check takes `FOR KEY SHARE` on the asset). So:
 * - a kit insert that got there first makes this lock wait until it commits,
 *   and the membership read after the lock then sees the new row;
 * - an assignment that got there first makes the kit insert wait, and
 *   `updateKitAssets` re-reads custody after its insert, so it sees the
 *   committed custody row and refuses.
 * Both halves are needed: drop either one and two operators acting at the
 * same moment can both pass. Both sides lock through {@link lockAssetRows}, in
 * id order, so neither two assignments nor an assignment and a kit add over
 * overlapping assets can deadlock.
 *
 * The lock must come before the assignment's own status write. A kit add can
 * write the member's status after its insert (a checked-out kit marks it
 * checked out); if the assignment already held its status-write lock, each
 * transaction would wait on the other.
 *
 * @param tx - the active transaction the assignment runs in
 * @param assetIds - assets about to be put into custody (request input)
 * @param organizationId - the caller's workspace; memberships in any other
 *   workspace are ignored
 * @throws {ShelfError} 400 giving the number of kit members and naming the
 *   first few
 */
export async function assertNotKitMembers(
  tx: Pick<typeof db, "assetKit" | "$queryRaw">,
  assetIds: Asset["id"][],
  organizationId: Asset["organizationId"]
) {
  await lockAssetRows(tx, assetIds, organizationId, "FOR UPDATE");
  await refuseKitMembers(tx, assetIds, organizationId);
}

/**
 * Takes the kit-membership lock on assets about to be added to a kit, in the
 * same id order {@link assertNotKitMembers} uses.
 *
 * An `AssetKit` insert takes `FOR KEY SHARE` on each asset through its
 * foreign-key check, in the order the rows are written. A custody assignment
 * over the same assets takes `FOR UPDATE` in id order. Two transactions taking
 * conflicting locks on the same rows in different orders deadlock, and
 * Postgres aborts one of them. Taking `FOR KEY SHARE` here, in id order,
 * before the insert makes both sides queue in one order instead. The insert's
 * own checks then find the locks already held.
 *
 * `FOR KEY SHARE` is the weakest lock that conflicts with `FOR UPDATE`, so two
 * kit edits, or a status change, on the same asset do not wait on each other.
 *
 * Call it inside the kit transaction, immediately before the `AssetKit`
 * insert.
 *
 * @param tx - the active transaction that inserts the `AssetKit` rows
 * @param assetIds - assets about to join the kit
 * @param organizationId - the caller's workspace
 */
export async function lockAssetsForKitMembership(
  tx: Pick<typeof db, "$queryRaw">,
  assetIds: Asset["id"][],
  organizationId: Asset["organizationId"]
) {
  await lockAssetRows(tx, assetIds, organizationId, "FOR KEY SHARE");
}

/**
 * Releases all custody for an asset, setting its status to AVAILABLE unless it
 * is checked out on a booking.
 *
 * **INDIVIDUAL assets only, and never kit-derived custody.** The `deleteMany`
 * below releases ALL custodians at once, which is exactly one row for an
 * INDIVIDUAL asset and every custodian's row for a `QUANTITY_TRACKED` one.
 * Custody a kit put on the asset is owned by the kit and is refused here by
 * {@link assertNoKitDerivedCustody}; it clears when the kit's own custody is
 * released, or when the asset leaves the kit. QT releases belong to
 * `releaseQuantity()`
 * in the asset service, which takes a quantity and releases one custodian's
 * slice. Both callers enforce the contract with `isQuantityTracked` before
 * calling in, so the delete is deliberately NOT scoped to a single custodian —
 * scoping it would be dead code on the only shape that reaches here, and would
 * make the `self`-scoped path silently diverge from the unrestricted one.
 *
 * @param assetId - The ID of the asset to release custody from
 * @param organizationId - The organization ID
 * @param userId - The caller's user ID (for the `self` custody scope)
 * @param custodyAssign - The caller's custody scope; `self` may only release
 *   their own custody
 * @param activityEvent - Optional activity event data for audit trail
 *   (records `CUSTODY_RELEASED` atomically when provided)
 */
export async function releaseCustody({
  assetId,
  organizationId,
  userId,
  custodyAssign,
  activityEvent,
}: {
  assetId: Asset["id"];
  organizationId: Asset["organizationId"];
  userId: User["id"];
  /**
   * The caller's custody-assignment scope (`access.custody.assign`). With
   * `"self"` the service refuses to touch custody of anyone but the caller,
   * for every caller (web and mobile).
   */
  custodyAssign: RoleAccess["custody"]["assign"];
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
       * A caller whose scope is `self` may only release custody assigned to
       * them.
       *
       * Read INSIDE the transaction: a check before it is a TOCTOU gap in the
       * authorization itself. Custody reassigned between the read and the
       * delete would let a `self`-scoped caller release a custodian that is no
       * longer theirs. Same reasoning as the status guard below, applied to
       * the permission rather than the column.
       *
       * The catch at the bottom rethrows `ShelfError` untouched, so this 403
       * still reaches the user as itself rather than as the generic message.
       */
      if (custodyAssign === "self") {
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
      // `asset: { organizationId }` — `assetId` is request input, so the delete
      // must prove org ownership itself. Splitting the old org-scoped
      // `asset.update` (which carried the nested delete) left this statement
      // unscoped: a cross-org id would delete another tenant's custody rows and
      // only be undone by the `findUniqueOrThrow` below happening to throw. That
      // is incidental ordering, not a guard.
      // @see .claude/rules/org-scope-user-supplied-ids.md
      // `kitCustodyId: null` — this release owns only operator-assigned rows.
      // Kit-derived rows are the kit's to remove, so they are scoped out of
      // the delete and left for the assert below to reject.
      // @see {@link assertNoKitDerivedCustody} for what that ordering does and
      // does not guarantee.
      await tx.custody.deleteMany({
        where: { assetId, asset: { organizationId }, kitCustodyId: null },
      });

      await assertNoKitDerivedCustody(tx, [assetId], organizationId);

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
