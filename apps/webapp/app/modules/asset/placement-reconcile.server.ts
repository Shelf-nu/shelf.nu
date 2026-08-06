/**
 * Placement reconciliation on stock decrease.
 *
 * The quantitative-assets PRD makes `Asset.quantity` canonical and models
 * Location / Kit / Custody / Booking as **orthogonal claims** over those units,
 * each carrying its own `sum <= Asset.quantity` invariant. Claims may overlap:
 * Johnny holding 30 of Office 1's pens means `AssetLocation = 100` AND
 * `Custody = 30`, not 100 and 70, because custody describes responsibility
 * rather than physical relocation.
 *
 * Consumption is not another claim. It **destroys units**, lowering the very
 * total every claim is measured against. So a consume can push a previously
 * valid placement sum above `Asset.quantity`, breaking the PRD's own invariant.
 *
 * Nothing catches this today. `asset_location_sum_within_total` is
 * `AFTER INSERT OR UPDATE OR DELETE ON "AssetLocation"`, so it never fires on an
 * `Asset` write, and `assertAssetQuantityNotBelowReservations` queries custody /
 * assetKit / bookingAsset / consumptionLog — not assetLocation. The drift is
 * therefore silent until a later, legitimate placement edit trips the
 * constraint and is refused.
 *
 * ## Why unplaced absorbs first, and why that needs no code
 *
 * "Unplaced" is not a stored row — it is the residual
 * `Asset.quantity - SUM(AssetLocation.quantity WHERE assetKitId IS NULL)`.
 * While a residual remains, lowering the total simply shrinks it, no placement
 * write required, and nothing is asserted about any location. That is also the
 * honest default: reducing a placement claims "this room now holds N fewer",
 * which may be false, whereas shrinking the residual claims nothing new.
 *
 * This module therefore only engages once the residual is exhausted.
 *
 * @see {@link file://./service.server.ts} `releaseQuantity` (custody consume)
 * @see {@link file://../booking/service.server.ts} check-in consume / loss / damage
 * @see {@link file://../../../../packages/database/prisma/migrations/20260519143054_add_asset_location_pivot/migration.sql}
 */

import type { Prisma } from "@prisma/client";

import type { ErrorLabel } from "~/utils/error";
import { ShelfError } from "~/utils/error";

const label: ErrorLabel = "Assets";

/**
 * Minimal client surface this module reads through — the `assetLocation`
 * delegate only. A `Pick` so both the root `db` client and an interactive
 * transaction client satisfy it without a cast, letting callers thread their
 * active `tx` straight in (the reconcile MUST commit with the stock decrease).
 */
export type PlacementReconcileTxClient = {
  assetLocation: {
    findMany: (args: Prisma.AssetLocationFindManyArgs) => Promise<
      Array<{ id: string; locationId: string; quantity: number }>
    >;
    update: (args: Prisma.AssetLocationUpdateArgs) => Promise<unknown>;
  };
};

/** What {@link reconcileManualPlacementsForStockDecrease} did, for the caller's audit trail. */
export type PlacementReconcileResult =
  | {
      /** Placement sum already fitted under the new total. Nothing written. */
      outcome: "within_total";
    }
  | {
      /** Exactly one manual placement existed, so the source was unambiguous. */
      outcome: "reduced";
      locationId: string;
      /** Units removed from that placement. */
      reducedBy: number;
    }
  | {
      /**
       * Several manual placements and no residual left, so which location lost
       * the units is genuinely unknown. Deliberately NOT guessed — see the
       * module note below.
       */
      outcome: "ambiguous";
      /** How far the placement sum still exceeds the total. */
      deficit: number;
      /** The placements in contention, for the caller's message / telemetry. */
      locationIds: string[];
    };

/**
 * Bring the manual placement sum back within `newTotal` after stock has been
 * destroyed.
 *
 * Only **manual** rows participate (`assetKitId IS NULL`). Kit-driven rows are
 * bounded separately by `enforce_asset_kit_sum_within_total` and were excluded
 * from the location-axis sum by `20260602100000_assetlocation_sum_exclude_kit_driven`
 * precisely so the two axes stop conflating; reducing them here would reach
 * across that boundary.
 *
 * ## The multi-placement case is left alone on purpose
 *
 * With one placement there is no judgement call: the units can only have come
 * from there, so decrementing it records a fact. With several, nothing in the
 * schema records which location the consumed units left — `Custody` carries no
 * `locationId` — so any rule we applied (largest-first, proportional, oldest)
 * would write a number into the database that was never true, and would do so
 * invisibly. Proportional splitting is the worst of these: it also produces
 * fractional units the column cannot hold.
 *
 * Returning `ambiguous` keeps that decision with the caller, which can surface
 * it honestly rather than fabricate provenance. Resolving it properly means
 * capturing the source at assignment time, which is a separate change.
 *
 * @param assetId - Asset whose placements to reconcile
 * @param newTotal - `Asset.quantity` as it will be AFTER the decrease
 * @param tx - Active transaction client; the reconcile must commit atomically
 *   with the stock decrease that motivated it
 * @returns What was done, for the caller to record
 */
export async function reconcileManualPlacementsForStockDecrease({
  assetId,
  newTotal,
  tx,
}: {
  assetId: string;
  newTotal: number;
  tx: PlacementReconcileTxClient;
}): Promise<PlacementReconcileResult> {
  const placements = await tx.assetLocation.findMany({
    where: { assetId, assetKitId: null },
    select: { id: true, locationId: true, quantity: true },
    orderBy: { createdAt: "asc" },
  });

  const placedSum = placements.reduce(
    (sum, placement) => sum + placement.quantity,
    0
  );

  // The residual absorbed it (or there are no placements at all).
  if (placedSum <= newTotal) {
    return { outcome: "within_total" };
  }

  const deficit = placedSum - newTotal;

  if (placements.length > 1) {
    return {
      outcome: "ambiguous",
      deficit,
      locationIds: placements.map((placement) => placement.locationId),
    };
  }

  const [only] = placements;

  /**
   * Clamp at zero as defence-in-depth. `deficit <= only.quantity` holds
   * whenever the caller's `newTotal` is non-negative, but a negative row would
   * breach the pivot's own semantics, so never write one.
   */
  const reducedBy = Math.min(deficit, only.quantity);

  await tx.assetLocation.update({
    // eslint-disable-next-line local-rules/require-org-scope-on-id-queries -- idor-safe: `only.id` is not user input; it comes from the `findMany` above, which is scoped to `assetId` — and every caller reaches this with that asset already org-verified and row-locked via `lockAssetForQuantityUpdate`
    where: { id: only.id },
    data: { quantity: only.quantity - reducedBy },
  });

  return { outcome: "reduced", locationId: only.locationId, reducedBy };
}

/**
 * Minimal client surface {@link assertStockNotBelowManualPlacements} reads
 * through — the read half of {@link PlacementReconcileTxClient}, since the
 * guard never writes.
 *
 * why(findMany-not-aggregate): the sum is all this needs, but Prisma types
 * `aggregate`'s return generically off its argument, so a hand-written
 * signature for it is not assignable from the real client without a cast.
 * `findMany` types cleanly and the row set is bounded by the number of
 * locations an asset is placed at — a handful, not a scan.
 */
export type PlacementGuardTxClient = {
  assetLocation: Pick<PlacementReconcileTxClient["assetLocation"], "findMany">;
};

/**
 * MANUAL stock-lowering guard for the location axis.
 *
 * The counterpart to {@link reconcileManualPlacementsForStockDecrease}, and
 * deliberately the opposite answer. Consumption cannot be refused — the units
 * are already gone by the time the code runs, so the placement sum has to be
 * reconciled after the fact. A person typing a smaller total has changed
 * nothing physical yet, so the honest response is to refuse and let them say
 * where the units went, rather than silently trimming a location on their
 * behalf.
 *
 * Only MANUAL rows count (`assetKitId IS NULL`): kit-driven placements are
 * bounded by `enforce_asset_kit_sum_within_total` on their own axis, and
 * `20260602100000_assetlocation_sum_exclude_kit_driven` took them out of the
 * location-axis sum precisely so the two stop conflating.
 *
 * This is a SEPARATE check from `assertAssetQuantityNotBelowReservations`, not
 * an extra term inside its `committed` total. Custody, kits and bookings are
 * claims on the same units and overlap by design; placement is an orthogonal
 * axis with its own `sum <= Asset.quantity` invariant. Adding it into
 * `committed` would reject reductions that are perfectly legal — 100 pens
 * placed at Office 1 with 30 in Johnny's custody is 100 committed on the
 * location axis and 30 on the custody axis, not 130.
 *
 * @param assetId - Asset whose total is being lowered
 * @param organizationId - Caller's organization, for the error payload
 * @param newTotal - `Asset.quantity` as it would be AFTER this write
 * @param tx - Active transaction client, with the asset row already locked so
 *   the read-then-decide is race-safe (same contract as the reservations guard)
 * @param assetTitle - Used in the rejection message
 * @param unitOfMeasure - Used in the rejection message
 * @throws {ShelfError} 400 (`shouldBeCaptured: false`) when the manual
 *   placement sum would exceed `newTotal`
 */
export async function assertStockNotBelowManualPlacements({
  assetId,
  organizationId,
  newTotal,
  tx,
  assetTitle,
  unitOfMeasure,
}: {
  assetId: string;
  organizationId: string;
  newTotal: number;
  tx: PlacementGuardTxClient;
  assetTitle?: string;
  unitOfMeasure?: string | null;
}): Promise<void> {
  const placements = await tx.assetLocation.findMany({
    where: { assetId, assetKitId: null },
    select: { id: true, locationId: true, quantity: true },
  });
  const placedSum = placements.reduce(
    (sum, placement) => sum + placement.quantity,
    0
  );

  if (placedSum <= newTotal) {
    return;
  }

  const title = assetTitle ?? "This asset";
  const unit = unitOfMeasure || "units";

  throw new ShelfError({
    cause: null,
    title: "Cannot reduce quantity below what is placed",
    message: `Cannot reduce "${title}" to ${newTotal} ${unit} — ${placedSum} ${unit} are assigned to locations. Lower the placements first, then reduce the total.`,
    additionalData: { assetId, organizationId, newTotal, placedSum },
    label,
    status: 400,
    shouldBeCaptured: false,
  });
}
