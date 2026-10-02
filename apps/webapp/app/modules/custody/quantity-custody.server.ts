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
 *   written, the whole-asset bulk call runs next, and
 *   {@link assignQuantities} / {@link releaseQuantities} then move the units,
 *   reporting any asset whose write was refused.
 *
 * Why that order: the bulk services validate and write in one transaction, so
 * once the checks here pass, the only refusal left is a concurrent change to
 * one asset between the check and its write. That refusal lands after other
 * writes have committed, so it is reported per asset rather than as a failure
 * of the whole submission, which a client would retry.
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
import { AssetType, OrganizationRoles } from "@prisma/client";
import { db } from "~/database/db.server";
import { computeCustodyAvailability } from "~/modules/asset/availability-primitives.server";
import {
  isUnplacedSource,
  unitsLeftAtSource,
} from "~/modules/asset/custody-source";
import {
  assignSourceNoteSuffix,
  loadCustodySources,
  releaseSourceNoteSuffix,
} from "~/modules/asset/custody-source.server";
import type { ReleaseSourceLine } from "~/modules/asset/service.server";
import {
  checkOutQuantity,
  releaseQuantity,
} from "~/modules/asset/service.server";
import { checkAndNotifyLowStock } from "~/modules/consumption-log/low-stock.server";
import { createNote } from "~/modules/note/service.server";
import { getUserByID } from "~/modules/user/service.server";
import { isLikeShelfError, ShelfError } from "~/utils/error";
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
 * The self-service rule is checked here too. `checkOutQuantity` enforces it on
 * the write, but a refusal there arrives per asset and reads as a concurrent
 * change, so a submission that could never succeed would report a partial one.
 *
 * A pool placed at two or more locations may also name where its units come
 * from (`sourceLocations`, sent by the web scanner). That location caps the
 * hand-over too: placed there minus already in custody from there, the same
 * rule `checkOutQuantity` applies under its lock.
 *
 * @param args.quantityAssetIds - Assets moved by units (see {@link splitQuantityAssetIds}).
 * @param args.quantities - Units per asset id.
 * @param args.sourceLocations - Optional source per asset id: a location id,
 *   or `"unplaced"`. Assets without an entry are checked pool-wide only.
 * @param args.organizationId - The caller's workspace.
 * @param args.custodian - Who receives the units.
 * @param args.role - The acting user's role.
 * @param args.userId - The acting user.
 * @throws {ShelfError} 403 when a self-service user assigns units to anyone
 *   but themselves; 400 "Nothing was assigned. ..." naming each asset that
 *   asked for more units than are free (or than its chosen location has
 *   left), is not tracked by quantity, or is not in the workspace.
 */
export async function assertAssignableQuantities({
  quantityAssetIds,
  quantities,
  sourceLocations = {},
  organizationId,
  custodian,
  role,
  userId,
}: {
  quantityAssetIds: string[];
  quantities: Record<string, number>;
  sourceLocations?: Record<string, string>;
  organizationId: string;
  custodian: QuantityCustodian;
  /** The acting user's role: self-service may only assign to themselves. */
  role: OrganizationRoles;
  /** The acting user. */
  userId: string;
}): Promise<void> {
  if (!quantityAssetIds.length) return;

  if (
    role === OrganizationRoles.SELF_SERVICE &&
    custodian.user?.id !== userId
  ) {
    throw new ShelfError({
      cause: null,
      title: "Action not allowed",
      status: 403,
      label: "Assets",
      shouldBeCaptured: false,
      message:
        "Nothing was assigned. Self-service users can only assign custody to themselves.",
      additionalData: { userId, custodianId: custodian.id },
    });
  }

  const unavailable: string[] = [];

  for (const assetId of quantityAssetIds) {
    const asset = await db.asset.findFirst({
      where: { id: assetId, organizationId },
      select: { title: true, quantity: true, type: true },
    });

    if (!asset) {
      unavailable.push("an asset that is not in this workspace");
      continue;
    }
    if (asset.type !== AssetType.QUANTITY_TRACKED) {
      unavailable.push(`"${asset.title}" (not tracked by quantity)`);
      continue;
    }

    const { available } = await computeCustodyAvailability(db, {
      assetId,
      organizationId,
      totalQuantity: asset.quantity ?? 0,
    });

    if (quantities[assetId] > available) {
      unavailable.push(
        `"${asset.title}" (asked for ${quantities[assetId]}, ${available} free)`
      );
      continue;
    }

    const source = sourceLocations[assetId];
    if (source !== undefined) {
      const locationId = isUnplacedSource(source) ? null : source;
      const { state } = await loadCustodySources(db, {
        assetId,
        total: asset.quantity ?? 0,
      });
      const left = unitsLeftAtSource(state, locationId);
      if (quantities[assetId] > left) {
        const where = locationId
          ? `left at ${
              (
                await db.location.findFirst({
                  where: { id: locationId, organizationId },
                  select: { name: true },
                })
              )?.name ?? "the chosen location"
            }`
          : "unplaced left";
        unavailable.push(
          `"${asset.title}" (asked for ${quantities[assetId]}, ${left} ${where})`
        );
      }
    }
  }

  if (unavailable.length) {
    throw new ShelfError({
      cause: null,
      title: "These units cannot be assigned",
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
 * kit, which cascade-deletes it. One person can hold several operator rows on
 * the same asset, one per location the units came from, so holders are
 * counted by person and their units summed; `releaseQuantity` draws from
 * those rows itself.
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
 * @param args.role - The acting user's role.
 * @param args.userId - The acting user.
 * @returns One resolved release per asset, in the given order.
 * @throws {ShelfError} 400 when an asset has no operator-held units, more than
 *   one holder, is not tracked by quantity, or has fewer units held than asked
 *   for; 403 when a self-service
 *   user asks to release units someone else holds.
 */
export async function resolveQuantityReleases({
  quantityAssetIds,
  quantities,
  organizationId,
  role,
  userId,
}: {
  quantityAssetIds: string[];
  quantities: Record<string, number>;
  organizationId: string;
  /** The acting user's role: self-service may only release their own units. */
  role: OrganizationRoles;
  /** The acting user. */
  userId: string;
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
      asset: { select: { title: true, type: true } },
      custodian: { select: QUANTITY_CUSTODIAN_SELECT },
    },
  });

  return quantityAssetIds.map((assetId) => {
    const rows = custodyRows.filter((row) => row.assetId === assetId);
    const holderIds = new Set(rows.map((row) => row.custodian.id));

    if (holderIds.size !== 1) {
      throw new ShelfError({
        cause: null,
        status: 400,
        label: "Assets",
        shouldBeCaptured: false,
        message:
          holderIds.size === 0
            ? "This asset has no units in anyone's custody to release."
            : `"${rows[0].asset.title}" is held by more than one person. Release it from the asset's custody list, where each holder is listed separately.`,
        additionalData: { assetId, holders: holderIds.size },
      });
    }

    const holder = {
      ...rows[0],
      quantity: rows.reduce((sum, row) => sum + row.quantity, 0),
    };
    // `releaseQuantity` refuses anything else on the write, where the refusal
    // would read as a concurrent change after other assets were released.
    if (holder.asset.type !== AssetType.QUANTITY_TRACKED) {
      throw new ShelfError({
        cause: null,
        status: 400,
        label: "Assets",
        shouldBeCaptured: false,
        message: `Nothing was released. "${holder.asset.title}" is not tracked by quantity, so it is released whole, not by units.`,
        additionalData: { assetId },
      });
    }

    // `releaseQuantity` applies the same rule on the write; checking it here
    // makes the refusal arrive before anything is written.
    if (
      role === OrganizationRoles.SELF_SERVICE &&
      holder.custodian.user?.id !== userId
    ) {
      throw new ShelfError({
        cause: null,
        title: "Action not allowed",
        status: 403,
        label: "Assets",
        shouldBeCaptured: false,
        message: `Nothing was released. "${holder.asset.title}" is held by someone else, and self-service users can only release their own custody.`,
        additionalData: { assetId, userId },
      });
    }

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
  /**
   * The source location: for an assignment, where the units come from; for
   * a release, whose units go back. A location id, or `"unplaced"` / `""` /
   * null for the unplaced units. Omit to let the service resolve it (see
   * `resolveCustodySource` and the release drain order).
   */
  locationId?: string | null;
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
  locationId,
}: QuantityCustodyArgs): Promise<void> {
  const { source } = await checkOutQuantity({
    assetId,
    teamMemberId: custodian.id,
    quantity,
    userId,
    organizationId,
    role,
    note,
    locationId,
  });

  // " from <Location>" for a pool placed at two or more locations; empty
  // otherwise, so every other asset's note reads as it always has.
  const fromSource = assignSourceNoteSuffix(source);
  await writeQuantityNote({
    assetId,
    userId,
    organizationId,
    note,
    baseLine: (actor) =>
      role === OrganizationRoles.SELF_SERVICE
        ? `${actor} took custody of **${quantity}** unit(s)${fromSource}.`
        : `${actor} assigned **${quantity}** unit(s) to ${custodianDisplay(
            custodian
          )}${fromSource}.`,
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
 * @param args.sources - Per-location lines, when the holder releases units
 *   taken from several locations one location at a time.
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
  locationId,
  sources,
}: QuantityCustodyArgs & {
  consumed?: number;
  sources?: ReleaseSourceLine[];
}): Promise<{
  consumed: number;
  returned: number;
}> {
  const {
    consumed: consumedUnits,
    returned: returnedUnits,
    lines,
    multiSource,
  } = await releaseQuantity({
    assetId,
    teamMemberId: custodian.id,
    quantity,
    consumed,
    userId,
    organizationId,
    role,
    note,
    locationId,
    sources,
  });

  // For a pool placed at two or more locations the note says which
  // locations the units came from; otherwise it carries no location at all.
  const fromSources = releaseSourceNoteSuffix({ lines, multiSource });
  await writeQuantityNote({
    assetId,
    userId,
    organizationId,
    note,
    baseLine: (actor) => {
      const holder = custodianDisplay(custodian);
      if (consumedUnits > 0 && returnedUnits > 0) {
        return `${actor} ended ${holder}'s hold on **${quantity}** unit(s)${fromSources}: **${consumedUnits}** consumed and **${returnedUnits}** returned to stock.`;
      }
      if (consumedUnits > 0) {
        return `${actor} marked **${consumedUnits}** unit(s) held by ${holder} as consumed${fromSources}. Stock reduced permanently.`;
      }
      return `${actor} released **${returnedUnits}** unit(s) from ${holder}'s custody${fromSources}.`;
    },
  });

  await runLowStockCheck({ assetId, userId, organizationId });

  return { consumed: consumedUnits, returned: returnedUnits };
}

/** A per-unit write that was refused after the checks passed. */
export type QuantityRefusal = {
  assetId: string;
  /** The asset's title, so a message can say which asset it was. */
  title: string;
  /** The service's reason. */
  message: string;
};

/**
 * Assigns the units of every checked asset to one custodian, in order.
 *
 * Call it after {@link assertAssignableQuantities} and the whole-asset bulk
 * call. Each asset is its own transaction, so a refusal here (a concurrent
 * change to that asset since the check) does not stop the rest: the asset is
 * reported and the loop moves on.
 *
 * @returns The refused assets, with the reason; empty when every write landed.
 */
export async function assignQuantities({
  quantityAssetIds,
  quantities,
  sourceLocations = {},
  custodian,
  userId,
  organizationId,
  role,
}: {
  quantityAssetIds: string[];
  quantities: Record<string, number>;
  /** Optional source per asset id, as checked by {@link assertAssignableQuantities}. */
  sourceLocations?: Record<string, string>;
  custodian: QuantityCustodian;
  userId: string;
  organizationId: string;
  role: OrganizationRoles;
}): Promise<QuantityRefusal[]> {
  const refusals: QuantityRefusal[] = [];
  for (const assetId of quantityAssetIds) {
    try {
      await assignQuantityToCustodian({
        assetId,
        custodian,
        quantity: quantities[assetId],
        userId,
        organizationId,
        role,
        // Undefined for pools the scanner showed no picker for: the service
        // then resolves the source as for any caller that does not ask.
        locationId: sourceLocations[assetId],
      });
    } catch (cause) {
      refusals.push(await refusalFor(assetId, organizationId, cause));
    }
  }
  return refusals;
}

/**
 * Releases the units of every resolved asset from its holder, in order.
 *
 * Call it after {@link resolveQuantityReleases} and the whole-asset bulk call.
 * Like {@link assignQuantities}, a refused asset is reported and the loop
 * moves on.
 *
 * @returns The refused assets, with the reason; empty when every write landed.
 */
export async function releaseQuantities({
  releases,
  quantities,
  userId,
  organizationId,
  role,
}: {
  releases: ResolvedQuantityRelease[];
  quantities: Record<string, number>;
  userId: string;
  organizationId: string;
  role: OrganizationRoles;
}): Promise<QuantityRefusal[]> {
  const refusals: QuantityRefusal[] = [];
  for (const { assetId, custodian } of releases) {
    try {
      await releaseQuantityFromCustodian({
        assetId,
        custodian,
        quantity: quantities[assetId],
        userId,
        organizationId,
        role,
      });
    } catch (cause) {
      refusals.push(await refusalFor(assetId, organizationId, cause));
    }
  }
  return refusals;
}

/**
 * One error for a web submission some of whose per-unit writes were refused.
 * The rest of the submission was written, so the message says so: a blind
 * retry would move those units a second time.
 *
 * @param verb - "assigned" or "released".
 * @param refusals - From {@link assignQuantities} / {@link releaseQuantities}.
 */
export function quantityRefusalsError(
  verb: "assigned" | "released",
  refusals: QuantityRefusal[]
): ShelfError {
  return new ShelfError({
    cause: null,
    title: `Some units were not ${verb}`,
    message: `Everything else was ${verb}. Not ${verb}: ${refusals
      .map((refusal) => `"${refusal.title}": ${refusal.message}`)
      .join(" ")}`,
    additionalData: { refusals },
    label: "Assets",
    status: 409,
    shouldBeCaptured: false,
  });
}

/** Describes a refused per-unit write for the operator. */
async function refusalFor(
  assetId: string,
  organizationId: string,
  cause: unknown
): Promise<QuantityRefusal> {
  if (!isLikeShelfError(cause)) {
    Logger.error(
      new ShelfError({
        cause,
        message: "Unexpected failure in a per-unit custody write",
        label: "Assets",
        additionalData: { assetId },
      })
    );
  }

  // Best-effort: the title only makes the message clearer.
  let title = "An asset";
  try {
    const asset = await db.asset.findFirst({
      where: { id: assetId, organizationId },
      select: { title: true },
    });
    if (asset) title = asset.title;
  } catch {
    // keep the generic title
  }

  return {
    assetId,
    title,
    message: isLikeShelfError(cause)
      ? cause.message
      : "Something went wrong. Please try again.",
  };
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
