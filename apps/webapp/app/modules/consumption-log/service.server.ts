/**
 * ConsumptionLog Service
 *
 * Manages quantity-tracking operations for assets in Shelf.nu.
 * Handles creating consumption logs (CHECKOUT, RETURN, RESTOCK, ADJUSTMENT, LOSS),
 * querying paginated log history, computing available quantities, and adjusting
 * the total quantity of a quantity-tracked asset.
 *
 * Consumption logs are immutable audit records — they are never updated or deleted.
 * Direction (add/subtract) is determined by the category:
 *   - CHECKOUT / LOSS → subtract from available pool
 *   - RETURN → add back to available pool
 *   - RESTOCK / ADJUSTMENT → change total quantity
 *
 * @see {@link file://./quantity-lock.server.ts} — Row-level locking for concurrency
 * @see {@link file://../../../packages/database/prisma/schema.prisma} — ConsumptionLog model
 */

import type { ConsumptionCategory, Prisma } from "@prisma/client";
import {
  BookingStatus,
  ConsumptionCategory as ConsumptionCategoryEnum,
} from "@prisma/client";
import type { ExtendedPrismaClient } from "~/database/db.server";
import { db } from "~/database/db.server";
// `recordEvent` writes the structured activity-event audit row alongside the
// immutable ConsumptionLog. The activity-event service is a dependency-free
// leaf (imports only db + error + its own types), so this does NOT reintroduce
// the availability/booking cycle guarded against below.
import { recordEvent } from "~/modules/activity-event/service.server";
// Imported from the dependency-free leaf (NOT `availability.server`) to avoid
// the cycle `consumption-log → availability.server → booking/service.server →
// consumption-log`, which corrupts Vitest partial-mock bindings on
// `createConsumptionLog` in the booking suite. See the leaf's header doc.
import { assertAssetQuantityNotBelowReservations } from "~/modules/asset/availability-primitives.server";
import { assertStockNotBelowManualPlacements } from "~/modules/asset/placement-reconcile.server";
import type { ErrorLabel } from "~/utils/error";
import { ShelfError } from "~/utils/error";
import { lockAssetForQuantityUpdate } from "./quantity-lock.server";

const label: ErrorLabel = "Consumption Log";

/* -------------------------------------------------------------------------- */
/*                            createConsumptionLog                            */
/* -------------------------------------------------------------------------- */

/** Arguments for creating a consumption log entry. */
type CreateConsumptionLogArgs = {
  /** The asset this log entry belongs to */
  assetId: string;
  /** The category/type of consumption event */
  category: ConsumptionCategory;
  /** The number of units involved (must be > 0) */
  quantity: number;
  /** The user performing the action */
  userId: string;
  /** Optional free-text note explaining the action */
  note?: string;
  /** Optional booking associated with this consumption */
  bookingId?: string;
  /**
   * Optional BookingAsset row this disposition was performed against.
   * Set by check-in flows that know the exact slice (kit-driven vs
   * standalone). `NULL` for non-booking writers (adjustments etc.) and
   * for legacy callers — readers fall back to greedy attribution when
   * the column is null.
   */
  bookingAssetId?: string | null;
  /** Optional team member who received/returned items */
  custodianId?: string;
  /**
   * Optional Prisma interactive transaction client.
   * Typed as `any` because Prisma doesn't export a clean type for
   * `$transaction()` callbacks on extended PrismaClient instances —
   * the tx type is `Omit<ExtendedClient, ...>` which isn't assignable
   * to `Prisma.TransactionClient` or `typeof db`.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tx?: any;
};

/**
 * Creates a new consumption log entry for a quantity-tracked asset.
 *
 * The `quantity` field is always stored as a positive integer. The direction
 * (add or subtract) is inferred from the `category` by consuming code.
 *
 * @param args - The log entry details
 * @returns The created ConsumptionLog record
 * @throws {ShelfError} If quantity is not positive or the database operation fails
 */
export async function createConsumptionLog({
  assetId,
  category,
  quantity,
  userId,
  note,
  bookingId,
  bookingAssetId,
  custodianId,
  tx,
}: CreateConsumptionLogArgs) {
  try {
    if (quantity <= 0) {
      throw new ShelfError({
        cause: null,
        message: "Quantity must be greater than zero.",
        label,
        status: 400,
      });
    }

    /** Use the transaction client if provided, otherwise fall back to the default db client */
    const client = tx ?? db;

    return await client.consumptionLog.create({
      data: {
        assetId,
        category,
        quantity,
        userId,
        note: note ?? null,
        bookingId: bookingId ?? null,
        bookingAssetId: bookingAssetId ?? null,
        custodianId: custodianId ?? null,
      },
    });
  } catch (cause) {
    /** Re-throw ShelfErrors as-is to preserve status/message */
    if (cause instanceof ShelfError) {
      throw cause;
    }

    throw new ShelfError({
      cause,
      message:
        "Something went wrong while creating the consumption log. Please try again or contact support.",
      additionalData: { assetId, category, quantity, userId },
      label,
    });
  }
}

/* -------------------------------------------------------------------------- */
/*                            getConsumptionLogs                              */
/* -------------------------------------------------------------------------- */

/** Arguments for querying consumption logs for an asset. */
type GetConsumptionLogsArgs = {
  /** The asset whose logs to retrieve */
  assetId: string;
  /** Page number, starting at 1 (defaults to 1) */
  page?: number;
  /** Number of items per page (defaults to 25) */
  perPage?: number;
};

/**
 * Retrieves paginated consumption logs for a given asset.
 *
 * Logs are returned in reverse chronological order. Each log includes
 * the performing user, optional custodian, and optional booking details.
 *
 * @param args - The query parameters
 * @returns An object containing `logs` and `totalLogs` for pagination
 * @throws {ShelfError} If the database query fails
 */
export async function getConsumptionLogs({
  assetId,
  page = 1,
  perPage = 25,
}: GetConsumptionLogsArgs) {
  try {
    const skip = page > 1 ? (page - 1) * perPage : 0;
    const take = perPage >= 1 ? perPage : 25;

    const [logs, totalLogs] = await Promise.all([
      db.consumptionLog.findMany({
        where: { assetId },
        skip,
        take,
        orderBy: { createdAt: "desc" },
        include: {
          performedBy: {
            select: {
              firstName: true,
              lastName: true,
              profilePicture: true,
            },
          },
          custodian: {
            select: { name: true },
          },
          booking: {
            select: { name: true },
          },
        },
      }),
      db.consumptionLog.count({ where: { assetId } }),
    ]);

    return { logs, totalLogs };
  } catch (cause) {
    throw new ShelfError({
      cause,
      message:
        "Something went wrong while fetching consumption logs. Please try again or contact support.",
      additionalData: { assetId, page, perPage },
      label,
    });
  }
}

/* -------------------------------------------------------------------------- */
/*                         computeAvailableQuantity                           */
/* -------------------------------------------------------------------------- */

/** The breakdown of an asset's quantity by availability. */
export type AvailableQuantity = {
  /** Total quantity owned (asset.quantity) */
  total: number;
  /** Quantity currently assigned to custodians */
  inCustody: number;
  /** Quantity available for checkout (total - inCustody) */
  available: number;
};

/**
 * Minimal client surface {@link computeAvailableQuantity} reads through — the
 * `asset` and `custody` delegates only. A `Pick` of {@link ExtendedPrismaClient}
 * so BOTH the root `db` client and an interactive-transaction client satisfy it
 * without a cast (an interactive tx is structurally a subset of the extended
 * client), letting `getAssetAvailability` thread its active `tx` straight in.
 */
export type AvailableQuantityClient = Pick<
  ExtendedPrismaClient,
  "asset" | "custody"
>;

/**
 * Computes the available quantity for a quantity-tracked asset.
 *
 * Calculates how many units are currently in custody (summing all custody
 * records for the asset) and subtracts from the total to determine availability.
 *
 * @param assetId - The ID of the asset to compute availability for
 * @param client - Prisma client or interactive transaction. Defaults to the
 *   global `db`. `getAssetAvailability` passes its active `tx` so this read
 *   joins the caller's transaction — row locks taken and uncommitted writes
 *   made earlier in that tx are visible here, which is what keeps the
 *   availability write guards race-safe (reading `total`/`inCustody` outside
 *   the tx would defeat the `lockAssetForQuantityUpdate` serialization).
 * @returns The quantity breakdown: total, inCustody, and available
 * @throws {ShelfError} If the asset is not found or the query fails
 */
export async function computeAvailableQuantity(
  assetId: string,
  client: AvailableQuantityClient = db
): Promise<AvailableQuantity> {
  try {
    const [asset, custodySum] = await Promise.all([
      client.asset.findUniqueOrThrow({
        // eslint-disable-next-line local-rules/require-org-scope-on-id-queries -- idor-safe: `assetId` org-verified by the caller (adjustQuantity / checkout flows validate the asset against organizationId before logging)
        where: { id: assetId },
        select: { quantity: true },
      }),
      client.custody.aggregate({
        // `kitCustodyId: null` = OPERATOR custody only. Kit-inherited custody
        // rows (a kit holding this asset that is itself assigned custody) carry
        // a non-null `kitCustodyId`; those units are already accounted for via
        // `AssetKit.quantity` (`inKits`) in the availability model, so counting
        // them here too would double-deduct them from the pool.
        where: { assetId, kitCustodyId: null },
        _sum: { quantity: true },
      }),
    ]);

    const total = asset.quantity ?? 0;
    const inCustody = custodySum._sum.quantity ?? 0;

    return {
      total,
      inCustody,
      available: total - inCustody,
    };
  } catch (cause) {
    throw new ShelfError({
      cause,
      message:
        "Something went wrong while computing available quantity. Please try again or contact support.",
      additionalData: { assetId },
      label,
    });
  }
}

/* -------------------------------------------------------------------------- */
/*                     computeBookingAvailableQuantity                        */
/* -------------------------------------------------------------------------- */

/**
 * Computes available quantity for a quantity-tracked asset,
 * factoring in both custody AND booking reservations.
 *
 * Available = Total - InCustody - Reserved
 *
 * Where Reserved = sum, across bookings with status RESERVED, ONGOING, or
 * OVERDUE, of each booking's *remaining* reserved quantity for this asset.
 * Remaining is computed as `BookingAsset.quantity` minus any already-logged
 * disposition quantities (RETURN, CONSUME, LOSS, DAMAGE) from partial
 * check-ins — since Phase 3c partial check-in writes ConsumptionLog rows
 * without decrementing `BookingAsset.quantity`, the pivot stays at the
 * booked qty by design and we must subtract logged dispositions here.
 * Per-booking remaining is clamped at 0 as defence-in-depth.
 *
 * This is the booking-aware counterpart of {@link computeAvailableQuantity},
 * which only considers custody. Use this function when you need to know how
 * many units are actually available for new bookings or checkouts.
 *
 * @param assetId - The ID of the asset to compute availability for
 * @param excludeBookingId - Optional booking ID to exclude from the reserved
 *   count. Useful when checking availability for a booking that already holds
 *   some quantity of this asset (e.g., editing an existing booking).
 * @returns The quantity breakdown: total, inCustody, reserved, and available
 * @throws {ShelfError} If the asset is not found or the query fails
 */
export async function computeBookingAvailableQuantity(
  assetId: string,
  excludeBookingId?: string
): Promise<AvailableQuantity & { reserved: number }> {
  try {
    /** Reuse existing custody-based availability calculation */
    const { total, inCustody } = await computeAvailableQuantity(assetId);

    /** Build the where clause for selecting active reservations */
    const bookingAssetWhere: Prisma.BookingAssetWhereInput = {
      assetId,
      booking: {
        status: {
          in: [
            BookingStatus.RESERVED,
            BookingStatus.ONGOING,
            BookingStatus.OVERDUE,
          ],
        },
      },
    };

    /** Exclude a specific booking if provided (e.g., the booking being edited) */
    if (excludeBookingId) {
      bookingAssetWhere.bookingId = { not: excludeBookingId };
    }

    /**
     * Fetch the reserved pivot rows for this asset across active bookings.
     * We need individual rows (not an aggregate) so we can subtract the
     * per-booking logged disposition quantities before summing.
     */
    const reservedRows = await db.bookingAsset.findMany({
      where: bookingAssetWhere,
      select: { bookingId: true, assetId: true, quantity: true },
    });

    let reserved = 0;

    if (reservedRows.length > 0) {
      const bookingIds = reservedRows.map((r) => r.bookingId);

      /**
       * Sum already-logged disposition quantities per booking for this
       * asset. Dispositions are terminal for reserved units:
       *   - RETURN   — unit came back to stock
       *   - CONSUME  — unit consumed (permanently out)
       *   - LOSS     — unit reported lost
       *   - DAMAGE   — unit reported damaged
       * CHECKOUT is intentionally excluded: it represents a handoff into
       * custody, not a reduction of the booking's reservation footprint.
       */
      const loggedGroups = await db.consumptionLog.groupBy({
        by: ["bookingId"],
        where: {
          assetId,
          bookingId: { in: bookingIds },
          category: {
            in: [
              ConsumptionCategoryEnum.RETURN,
              ConsumptionCategoryEnum.CONSUME,
              ConsumptionCategoryEnum.LOSS,
              ConsumptionCategoryEnum.DAMAGE,
            ],
          },
        },
        _sum: { quantity: true },
      });

      /** bookingId → total logged disposition quantity for this asset */
      const loggedByBookingId = new Map<string, number>();
      for (const group of loggedGroups) {
        if (group.bookingId) {
          loggedByBookingId.set(group.bookingId, group._sum.quantity ?? 0);
        }
      }

      /**
       * For each active reservation, subtract the logged dispositions from
       * the booked quantity. Clamp at 0 per row so an over-logged booking
       * (should not happen, but defence-in-depth) can't push `reserved`
       * negative and silently inflate availability elsewhere.
       */
      for (const row of reservedRows) {
        const logged = loggedByBookingId.get(row.bookingId) ?? 0;
        const remaining = Math.max(0, row.quantity - logged);
        reserved += remaining;
      }
    }

    return {
      total,
      inCustody,
      reserved,
      available: total - inCustody - reserved,
    };
  } catch (cause) {
    /** Re-throw ShelfErrors as-is to preserve status/message */
    if (cause instanceof ShelfError) {
      throw cause;
    }

    throw new ShelfError({
      cause,
      message:
        "Something went wrong while computing booking-aware available quantity. Please try again or contact support.",
      additionalData: { assetId, excludeBookingId },
      label,
    });
  }
}

/* -------------------------------------------------------------------------- */
/*                              adjustQuantity                                */
/* -------------------------------------------------------------------------- */

/** Arguments for adjusting the total quantity of a quantity-tracked asset. */
type AdjustQuantityArgs = {
  /** The asset to adjust */
  assetId: string;
  /** The number of units to add or subtract (must be > 0) */
  quantity: number;
  /** The consumption category — must be RESTOCK, ADJUSTMENT, or LOSS */
  category: ConsumptionCategory;
  /** Whether to add or subtract from the total */
  direction: "add" | "subtract";
  /** The user performing the adjustment */
  userId: string;
  /** The organization that owns the asset (used for validation context) */
  organizationId: string;
  /** Optional note explaining the reason for the adjustment */
  note?: string;
};

/**
 * Adjusts the total quantity of a quantity-tracked asset.
 *
 * Used for RESTOCK (add stock), ADJUSTMENT (correction), and LOSS (reduce stock)
 * operations. These change the total pool size, unlike CHECKOUT/RETURN which
 * move units between the available pool and custody.
 *
 * Runs inside an interactive transaction with a row-level lock to prevent
 * concurrent modifications from producing inconsistent quantities.
 *
 * @param args - The adjustment details
 * @returns The updated Asset record
 * @throws {ShelfError} If the asset is not QUANTITY_TRACKED, quantity is invalid,
 *   or subtracting would reduce quantity below zero
 */
export async function adjustQuantity({
  assetId,
  quantity,
  category,
  direction,
  userId,
  organizationId,
  note,
}: AdjustQuantityArgs) {
  try {
    if (quantity <= 0) {
      throw new ShelfError({
        cause: null,
        message: "Quantity must be greater than zero.",
        label,
        status: 400,
      });
    }

    return await db.$transaction(async (tx) => {
      /** Step 1: Acquire row-level lock to prevent concurrent modifications */
      const asset = await lockAssetForQuantityUpdate(
        tx,
        assetId,
        organizationId
      );

      /**
       * Step 2: Validate asset belongs to the caller's organization.
       * Prevents cross-tenant IDOR: without this guard, any authenticated
       * user with `asset:update` in any org could mutate another org's
       * qty-tracked asset by passing its id. Mirrors the pattern used in
       * `checkOutQuantity` / `releaseQuantity` in `asset/service.server.ts`.
       *
       * Now defense-in-depth: `lockAssetForQuantityUpdate` is org-scoped, so a
       * foreign-org id already 404'd at Step 1 (no lock taken) and never reaches
       * here. We keep this belt-and-braces check to document the invariant.
       */
      if (asset.organizationId !== organizationId) {
        throw new ShelfError({
          cause: null,
          message: "Asset does not belong to this organization.",
          label,
          status: 403,
          additionalData: { assetId, organizationId },
        });
      }

      /** Step 3: Validate the asset is quantity-tracked */
      if (asset.type !== "QUANTITY_TRACKED") {
        throw new ShelfError({
          cause: null,
          message: "Only quantity-tracked assets support quantity adjustments.",
          label,
          status: 400,
          additionalData: { assetId, assetType: asset.type },
        });
      }

      const currentQuantity = asset.quantity ?? 0;

      /** Step 4: For subtraction, ensure the new total doesn't drop below in-custody */
      if (direction === "subtract") {
        const custodySum = await tx.custody.aggregate({
          where: { assetId },
          _sum: { quantity: true },
        });
        const inCustody = custodySum._sum.quantity ?? 0;
        const maxRemovable = currentQuantity - inCustody;

        if (quantity > maxRemovable) {
          throw new ShelfError({
            cause: null,
            message:
              inCustody > 0
                ? `Cannot remove ${quantity} units. Only ${maxRemovable} available (${inCustody} currently in custody).`
                : `Cannot remove ${quantity} units. The asset only has ${currentQuantity} total units.`,
            label,
            status: 400,
            additionalData: { assetId, quantity, currentQuantity, inCustody },
          });
        }

        /**
         * Reservations guard. The in-custody check above only protects units
         * held by custodians right now; this also blocks lowering the total
         * below what active bookings have RESERVED (their peak-concurrent
         * booked footprint) or what's allocated into kits. This is the shared
         * stock-lowering guard used by `updateAsset` too, so the `adjust
         * quantity` endpoint can't strand a reservation the asset-edit path
         * would reject. Runs inside this same tx with the asset already
         * row-locked above, so the read-then-decide is race-safe.
         */
        await assertAssetQuantityNotBelowReservations({
          assetId,
          organizationId,
          tx,
          newTotal: currentQuantity - quantity,
          assetTitle: asset.title,
          unitOfMeasure: asset.unitOfMeasure,
        });

        /**
         * Placement guard, the orthogonal axis the reservations guard does not
         * cover. `asset_location_sum_within_total` only fires on an
         * `AssetLocation` write, so lowering the total here would otherwise
         * leave locations claiming more units than the asset owns — invisible
         * until a later, legitimate placement edit is refused. Refused rather
         * than auto-trimmed: nothing has physically moved yet, so the operator
         * can unplace the right location first.
         */
        await assertStockNotBelowManualPlacements({
          assetId,
          organizationId,
          tx,
          newTotal: currentQuantity - quantity,
          assetTitle: asset.title,
          unitOfMeasure: asset.unitOfMeasure,
        });
      }

      /** Step 5: Compute the new total quantity */
      const newQuantity =
        direction === "add"
          ? currentQuantity + quantity
          : currentQuantity - quantity;

      /** Step 6: Update the asset's quantity */
      const updatedAsset = await tx.asset.update({
        // eslint-disable-next-line local-rules/require-org-scope-on-id-queries -- idor-safe: `assetId` org-verified earlier in this transaction via the locked asset's organizationId guard
        where: { id: assetId },
        data: { quantity: newQuantity },
      });

      /** Step 7: Create an immutable audit log entry */
      await createConsumptionLog({
        assetId,
        category,
        quantity,
        userId,
        note,
        tx,
      });

      /**
       * Step 8: Structured activity event for the reporting pipeline — one
       * `ASSET_QUANTITY_CHANGED` per total-quantity change, emitted inside the
       * SAME tx so it commits atomically with the asset update + log (see
       * `.claude/rules/use-record-event.md`). `fromValue`/`toValue` capture the
       * true direction the direction-agnostic ConsumptionLog cannot.
       */
      await recordEvent(
        {
          organizationId,
          actorUserId: userId,
          action: "ASSET_QUANTITY_CHANGED",
          entityType: "ASSET",
          entityId: assetId,
          assetId,
          field: "quantity",
          fromValue: currentQuantity,
          toValue: newQuantity,
        },
        tx
      );

      return updatedAsset;
    });
  } catch (cause) {
    /** Re-throw ShelfErrors as-is to preserve status/message */
    if (cause instanceof ShelfError) {
      throw cause;
    }

    throw new ShelfError({
      cause,
      message:
        "Something went wrong while adjusting the asset quantity. Please try again or contact support.",
      additionalData: {
        assetId,
        quantity,
        category,
        direction,
        organizationId,
      },
      label,
    });
  }
}
