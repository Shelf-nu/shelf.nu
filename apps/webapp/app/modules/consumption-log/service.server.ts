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

import type { ConsumptionCategory } from "@prisma/client";
import { db } from "~/database/db.server";
import { recordEvent } from "~/modules/activity-event/service.server";
import { getBookingPoolAvailabilityUnscopedForLegacyWrapper } from "~/modules/asset/availability.server";
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
 * Computes the available quantity for a quantity-tracked asset.
 *
 * Calculates how many units are currently in custody (summing all custody
 * records for the asset) and subtracts from the total to determine availability.
 *
 * CUSTODY FAMILY — intentionally NOT booking-aware, and intentionally NOT
 * merged into the canonical booking-pool module
 * (`~/modules/asset/availability.server`). Per the asset-overview rationale:
 * reservations deliberately don't subtract here because reserved units are
 * still physically present on the shelf until the booking checks out. This
 * family caps custody assignment and quantity adjustments; its siblings are
 * the overview's `custodyAvailable` and `low-stock.server.ts`. If you need
 * "can I reserve N more units for a booking?", use the booking family
 * ({@link computeBookingAvailableQuantity} / `getBookingPoolAvailability`)
 * instead — the two answer different questions by design.
 *
 * @param assetId - The ID of the asset to compute availability for
 * @returns The quantity breakdown: total, inCustody, and available
 * @throws {ShelfError} If the asset is not found or the query fails
 */
export async function computeAvailableQuantity(
  assetId: string
): Promise<AvailableQuantity> {
  try {
    const [asset, custodySum] = await Promise.all([
      db.asset.findUniqueOrThrow({
        // eslint-disable-next-line local-rules/require-org-scope-on-id-queries -- idor-safe: `assetId` org-verified by the caller (adjustQuantity / checkout flows validate the asset against organizationId before logging)
        where: { id: assetId },
        select: { quantity: true },
      }),
      db.custody.aggregate({
        where: { assetId },
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
 * BACK-COMPAT WRAPPER: since the canonical-module extraction this is a thin
 * delegation to `getBookingPoolAvailability`
 * (`~/modules/asset/availability.server`) with the guard family's fixed flag
 * set — `custodyScope: "all"`, `includeKitSlices: false`, global window,
 * `dispositionAware: true` — and `available` kept UNCLAMPED (signed): its
 * consumers (checkout guard, adjust-quantity route) branch on the sign to
 * detect oversubscription. The exported name, module path, signature, and
 * return shape are load-bearing for external PR #2744's test suite and for
 * `booking/service.server`'s checkout guard — do not move or reshape
 * without checking both.
 *
 * It also intentionally keeps reading through the ambient `db` client (no
 * `tx` param): callers rely on their own asset row lock + read-committed
 * isolation — a documented status quo (see the call-site comments and
 * #2744's scoping note).
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
    /**
     * `organizationId: null` — this legacy signature predates org threading;
     * every caller org-validates the asset id upstream (see the
     * `GetBookingPoolAvailabilityArgs` JSDoc). The unscoped entry point is
     * exported ONLY for this wrapper; new code must call the org-scoped
     * `getBookingPoolAvailability` directly with a real organizationId.
     */
    const poolMap = await getBookingPoolAvailabilityUnscopedForLegacyWrapper({
      assetIds: [assetId],
      organizationId: null,
      excludeBookingId,
      window: null,
      custodyScope: "all",
      includeKitSlices: false,
      dispositionAware: true,
    });

    const pool = poolMap.get(assetId);
    if (!pool) {
      /** Preserve the pre-wrapper not-found behavior (findUniqueOrThrow). */
      throw new ShelfError({
        cause: null,
        message: "Asset not found.",
        additionalData: { assetId },
        label,
        status: 404,
        shouldBeCaptured: false,
      });
    }

    return {
      total: pool.total,
      inCustody: pool.inCustody,
      /** The status-split telescopes back to the single active-booking sum. */
      reserved: pool.reserved + pool.checkedOut,
      /** Signed on purpose — consumers need to see oversubscription. */
      available: pool.raw,
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
      const asset = await lockAssetForQuantityUpdate(tx, assetId);

      /**
       * Step 2: Validate asset belongs to the caller's organization.
       * Prevents cross-tenant IDOR: without this guard, any authenticated
       * user with `asset:update` in any org could mutate another org's
       * qty-tracked asset by passing its id. Mirrors the pattern used in
       * `checkOutQuantity` / `releaseQuantity` in `asset/service.server.ts`.
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
       * Step 8: Structured activity event, in the SAME transaction
       * (`.claude/rules/use-record-event.md`).
       *
       * why: the "Quantity changed" row in the Asset Activity report reads
       * `ASSET_QUANTITY_CHANGED`. Emitting it only from `updateAsset`
       * (form/CSV) made the report tell a partial truth — Quick Adjust is
       * the primary way stock actually moves. `currentQuantity` is the value
       * read under the row lock acquired in Step 1, so the event can never
       * disagree with the ConsumptionLog written above.
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
