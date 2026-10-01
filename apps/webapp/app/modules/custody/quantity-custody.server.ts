/**
 * Quantity custody: handing units of a QUANTITY_TRACKED asset to a team member
 * and taking them back, shared by every route that does it.
 *
 * Two kinds of caller use this module:
 *
 * - The single-asset routes (web and mobile `assign-quantity` /
 *   `release-quantity`) move one asset's units through
 *   {@link assignQuantityToCustodian} / {@link releaseQuantityFromCustodian}.
 * - The bulk custody routes (web and mobile `bulk-assign-custody` /
 *   `bulk-release-custody`) take an optional `quantities` map from the
 *   scanners. {@link splitQuantityAssetIds} separates the assets named there
 *   from whole assets, {@link assertAssignableQuantities} /
 *   {@link resolveQuantityReleases} check every named asset before anything is
 *   written, and the same two per-asset functions then move the units.
 *
 * So a unit hand-over writes the same records whichever screen started it: the
 * service's consumption log and activity event, one audit note on the asset,
 * and a low-stock check.
 *
 * @see {@link file://./../asset/service.server.ts} checkOutQuantity, releaseQuantity
 * @see {@link file://./../../routes/api+/assets.bulk-assign-custody.ts}
 * @see {@link file://./../../routes/api+/mobile+/bulk-assign-custody.ts}
 */

import type { Prisma } from "@prisma/client";
import { OrganizationRoles } from "@prisma/client";
import { db } from "~/database/db.server";
import { computeCustodyAvailability } from "~/modules/asset/availability-primitives.server";
import {
  checkOutQuantity,
  releaseQuantity,
} from "~/modules/asset/service.server";
import { checkAndNotifyLowStock } from "~/modules/consumption-log/low-stock.server";
import { createNote } from "~/modules/note/service.server";
import { getUserByID } from "~/modules/user/service.server";
import { ShelfError } from "~/utils/error";
import { Logger } from "~/utils/logger";
import {
  appendUserTextToNote,
  wrapCustodianForNote,
  wrapUserLinkForNote,
} from "~/utils/markdoc-wrappers";

/** A team member as a quantity custody note names them. */
export type QuantityCustodian = {
  id: string;
  name: string;
  /** The linked user, or null for a team member without an account. */
  user: {
    id: string;
    firstName: string | null;
    lastName: string | null;
    displayName: string | null;
  } | null;
};

/** The Prisma select that yields a {@link QuantityCustodian}. */
export const QUANTITY_CUSTODIAN_SELECT = {
  id: true,
  name: true,
  user: {
    select: { id: true, firstName: true, lastName: true, displayName: true },
  },
} satisfies Prisma.TeamMemberSelect;

/**
 * Splits a bulk custody submission into the assets moved by units and the
 * assets moved whole.
 *
 * An asset is moved by units exactly when `quantities` has an entry for it.
 * Ids are collapsed first: the scanners key their rows by CODE, so an asset
 * scanned through both its QR and a barcode arrives twice, and each per-unit
 * write would otherwise run twice. `quantities` holds one number per asset, so
 * collapsing loses nothing. Entries for assets outside `assetIds` are ignored.
 *
 * @param assetIds - The submitted asset ids, possibly repeated.
 * @param quantities - Units per asset id, from the scanner's quantity rows.
 * @returns The two id lists, each without repeats, in submission order.
 */
export function splitQuantityAssetIds(
  assetIds: string[],
  quantities: Record<string, number>
): { quantityAssetIds: string[]; bulkAssetIds: string[] } {
  const uniqueAssetIds = [...new Set(assetIds)];
  const hasQuantity = (id: string) =>
    Object.prototype.hasOwnProperty.call(quantities, id);
  return {
    quantityAssetIds: uniqueAssetIds.filter(hasQuantity),
    bulkAssetIds: uniqueAssetIds.filter((id) => !hasQuantity(id)),
  };
}

/**
 * Checks every per-unit assignment of a submission before any is written.
 *
 * Each `checkOutQuantity` call is its own transaction, so once one has
 * committed nothing puts it back. Without this pass, a submission whose third
 * asset is over-subscribed would leave the first two assigned while the client
 * reports a failure, and a retry would assign those two again, because the call
 * increments an existing custody row rather than setting it.
 *
 * This is a pre-flight, not a lock: each write re-checks availability under its
 * own row lock, which is what prevents over-allocation if the pool moves in
 * between. What it buys is that the refusal an operator can provoke (asking
 * for more than is free) arrives before anything is written, naming every
 * asset that asked for too much.
 *
 * @param args.quantityAssetIds - Assets moved by units (see {@link splitQuantityAssetIds}).
 * @param args.quantities - Units per asset id.
 * @param args.organizationId - The caller's workspace.
 * @throws {ShelfError} 400 "Nothing was assigned. ..." naming each asset with
 *   the units asked for and the units free.
 */
export async function assertAssignableQuantities({
  quantityAssetIds,
  quantities,
  organizationId,
}: {
  quantityAssetIds: string[];
  quantities: Record<string, number>;
  organizationId: string;
}): Promise<void> {
  const unavailable: string[] = [];

  for (const assetId of quantityAssetIds) {
    const asset = await db.asset.findFirst({
      where: { id: assetId, organizationId },
      select: { title: true, quantity: true },
    });

    // `checkOutQuantity` refuses an unknown asset by name.
    if (!asset) continue;

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
}

/** A per-unit release, resolved to the one person it takes the units from. */
export type ResolvedQuantityRelease = {
  assetId: string;
  custodian: QuantityCustodian;
};

/**
 * Resolves who each per-unit release takes the units from, and checks every
 * release of a submission before any is written.
 *
 * A bulk release names no custodian: it takes the asset back from whoever
 * holds it. For a quantity-tracked asset that is only unambiguous while one
 * person holds it, so the single holder is resolved here and anything else is
 * refused by name rather than guessed at. Splitting a release across holders
 * is what the asset's own custody list is for.
 *
 * Only operator-assigned rows are candidates: a `Custody` row carrying a
 * `kitCustodyId` came with the kit's custody and goes back by releasing the
 * kit, which cascade-deletes it.
 *
 * Each `releaseQuantity` call commits its own transaction, so a refusal found
 * mid-loop would leave earlier assets released while the client reports a
 * failure, and a retry would release them again. `releaseQuantity` re-checks
 * the quantity under its own row lock; this pass makes the refusal arrive
 * before anything is written.
 *
 * @param args.quantityAssetIds - Assets moved by units (see {@link splitQuantityAssetIds}).
 * @param args.quantities - Units per asset id.
 * @param args.organizationId - The caller's workspace.
 * @returns One resolved release per asset, in the given order.
 * @throws {ShelfError} 400 when an asset has no operator-held units, more than
 *   one holder, or fewer units held than asked for.
 */
export async function resolveQuantityReleases({
  quantityAssetIds,
  quantities,
  organizationId,
}: {
  quantityAssetIds: string[];
  quantities: Record<string, number>;
  organizationId: string;
}): Promise<ResolvedQuantityRelease[]> {
  if (!quantityAssetIds.length) return [];

  const custodyRows = await db.custody.findMany({
    where: {
      assetId: { in: quantityAssetIds },
      kitCustodyId: null,
      asset: { organizationId },
    },
    select: {
      assetId: true,
      quantity: true,
      asset: { select: { title: true } },
      custodian: { select: QUANTITY_CUSTODIAN_SELECT },
    },
  });

  return quantityAssetIds.map((assetId) => {
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

    const [holder] = holders;
    if (quantities[assetId] > holder.quantity) {
      throw new ShelfError({
        cause: null,
        status: 400,
        label: "Assets",
        shouldBeCaptured: false,
        message: `Nothing was released. "${holder.asset.title}" has only ${holder.quantity} unit(s) in custody.`,
        additionalData: {
          assetId,
          requested: quantities[assetId],
          held: holder.quantity,
        },
      });
    }

    return { assetId, custodian: holder.custodian };
  });
}

/** What every per-unit custody change needs to know. */
type QuantityCustodyArgs = {
  assetId: string;
  /** Who receives the units, or whose units go back. */
  custodian: QuantityCustodian;
  /** Units to move; a positive integer. */
  quantity: number;
  /** The acting user. */
  userId: string;
  organizationId: string;
  /** The acting user's role; the services apply the self-service rules. */
  role: OrganizationRoles;
  /** Optional operator text, appended to the audit note. */
  note?: string;
};

/**
 * Assigns units of a QUANTITY_TRACKED asset to a team member.
 *
 * `checkOutQuantity` validates and writes the custody change, its consumption
 * log and its activity event in one transaction. Then, best-effort because the
 * change has already committed: an audit note on the asset, and the low-stock
 * check, since units in custody are no longer free.
 *
 * @param args - See {@link QuantityCustodyArgs}.
 * @throws {ShelfError} Whatever `checkOutQuantity` refuses (not enough free
 *   units, wrong workspace, a self-service user assigning to someone else).
 */
export async function assignQuantityToCustodian({
  assetId,
  custodian,
  quantity,
  userId,
  organizationId,
  role,
  note,
}: QuantityCustodyArgs): Promise<void> {
  await checkOutQuantity({
    assetId,
    teamMemberId: custodian.id,
    quantity,
    userId,
    organizationId,
    role,
    note,
  });

  await writeQuantityNote({
    assetId,
    userId,
    organizationId,
    note,
    baseLine: (actor) =>
      role === OrganizationRoles.SELF_SERVICE
        ? `${actor} took custody of **${quantity}** unit(s).`
        : `${actor} assigned **${quantity}** unit(s) to ${custodianDisplay(
            custodian
          )}.`,
  });

  await runLowStockCheck({ assetId, userId, organizationId });
}

/**
 * Ends a team member's hold on units of a QUANTITY_TRACKED asset.
 *
 * `releaseQuantity` decides what happens to the units from the asset's
 * `consumptionType` (and `consumed`, when given) and reports back the split it
 * wrote. The audit note is worded from that split, so it describes what was
 * persisted. The low-stock check runs after every release: returned units can
 * lift stock back over the threshold, which clears the alert marker.
 *
 * @param args - See {@link QuantityCustodyArgs}.
 * @param args.consumed - Of the released units, how many were used up. Omit to
 *   let the service derive it from the asset's consumption type.
 * @returns The units recorded as consumed and as returned to stock.
 * @throws {ShelfError} Whatever `releaseQuantity` refuses (more than is held,
 *   a self-service user releasing someone else's units).
 */
export async function releaseQuantityFromCustodian({
  assetId,
  custodian,
  quantity,
  consumed,
  userId,
  organizationId,
  role,
  note,
}: QuantityCustodyArgs & { consumed?: number }): Promise<{
  consumed: number;
  returned: number;
}> {
  const { consumed: consumedUnits, returned: returnedUnits } =
    await releaseQuantity({
      assetId,
      teamMemberId: custodian.id,
      quantity,
      consumed,
      userId,
      organizationId,
      role,
      note,
    });

  await writeQuantityNote({
    assetId,
    userId,
    organizationId,
    note,
    baseLine: (actor) => {
      const holder = custodianDisplay(custodian);
      if (consumedUnits > 0 && returnedUnits > 0) {
        return `${actor} ended ${holder}'s hold on **${quantity}** unit(s): **${consumedUnits}** consumed and **${returnedUnits}** returned to stock.`;
      }
      if (consumedUnits > 0) {
        return `${actor} marked **${consumedUnits}** unit(s) held by ${holder} as consumed. Stock reduced permanently.`;
      }
      return `${actor} released **${returnedUnits}** unit(s) from ${holder}'s custody.`;
    },
  });

  await runLowStockCheck({ assetId, userId, organizationId });

  return { consumed: consumedUnits, returned: returnedUnits };
}

/** The custodian as a note renders them: a user link, or their bold name. */
function custodianDisplay(custodian: QuantityCustodian): string {
  return wrapCustodianForNote({
    teamMember: { name: custodian.name, user: custodian.user },
  });
}

/**
 * Writes the audit note for a unit change. Best-effort: the change has already
 * committed, so a failed note is logged and must not turn a completed hand-over
 * into an error the client could retry.
 */
async function writeQuantityNote({
  assetId,
  userId,
  organizationId,
  note,
  baseLine,
}: {
  assetId: string;
  userId: string;
  organizationId: string;
  note?: string;
  baseLine: (actor: string) => string;
}): Promise<void> {
  try {
    const actorUser = await getUserByID(userId, {
      select: {
        id: true,
        firstName: true,
        lastName: true,
        displayName: true,
      } satisfies Prisma.UserSelect,
    });

    await createNote({
      content: appendUserTextToNote(
        baseLine(wrapUserLinkForNote(actorUser)),
        note
      ),
      type: "UPDATE",
      userId,
      assetId,
      organizationId,
    });
  } catch (noteError) {
    Logger.error(
      new ShelfError({
        cause: noteError,
        message: "Failed to create audit note for quantity operation",
        label: "Assets",
        additionalData: { assetId, userId },
      })
    );
  }
}

/**
 * Runs the debounced low-stock notifier for an asset. Best-effort for the same
 * reason as the note: the unit change has already committed.
 */
async function runLowStockCheck({
  assetId,
  userId,
  organizationId,
}: {
  assetId: string;
  userId: string;
  organizationId: string;
}): Promise<void> {
  try {
    await checkAndNotifyLowStock({ assetId, userId, organizationId });
  } catch (lowStockError) {
    Logger.error(
      new ShelfError({
        cause: lowStockError,
        message: "Failed to run the low-stock check after a quantity change",
        label: "Assets",
        additionalData: { assetId, organizationId },
      })
    );
  }
}
