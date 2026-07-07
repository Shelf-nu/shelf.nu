/**
 * Quantity Overview Card
 *
 * Displays a summary of quantity-tracking information for QUANTITY_TRACKED assets
 * on the asset detail overview page. Shows total quantity, available units,
 * units in custody, reserved/checked-out booking quantities, unit of measure,
 * optional low-stock alert threshold, and the consumption behavior mode.
 *
 * Availability and in-custody values are computed by the loader from actual
 * custody records and booking reservations, then passed as props.
 * Falls back to total/0 if not provided.
 *
 * @see {@link file://./../../routes/_layout+/assets.$assetId.overview.tsx} - Asset overview page
 * @see {@link file://./asset-custody-card.tsx} - Similar sidebar card pattern
 */

import type React from "react";
import type { ConsumptionType } from "@prisma/client";
import { TriangleAlertIcon } from "lucide-react";
import { Button } from "~/components/shared/button";
import { Card } from "~/components/shared/card";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "~/components/shared/tooltip";
import { tw } from "~/utils/tw";
import { QuickAdjustDialog } from "./quick-adjust-dialog";

/** Props for the QuantityOverviewCard component */
export interface QuantityOverviewCardProps {
  /** The asset's unique ID, used by the quick-adjust dialog */
  assetId: string;
  /** Total quantity of the asset */
  quantity: number | null;
  /** Unit of measure label (e.g., "pcs", "boxes", "liters") */
  unitOfMeasure: string | null;
  /** Low-stock alert threshold; when quantity <= minQuantity, a warning badge appears */
  minQuantity: number | null;
  /** Consumption behavior: ONE_WAY (used up) or TWO_WAY (returnable) */
  consumptionType: ConsumptionType | null;
  /**
   * Booking-aware availability (total - inCustody - reserved - checkedOut),
   * shown on the "Available" row. This is what's available to reserve for a
   * future booking.
   */
  availableQuantity?: number;
  /**
   * Physical availability (total - inCustody). Used as the cap for the
   * QuickAdjustDialog's "Remove" operation — subtracting reservations here
   * would wrongly block valid total-quantity adjustments when future
   * bookings exist. Falls back to `availableQuantity` when not provided.
   */
  custodyAvailableQuantity?: number;
  /**
   * Operator-only custody (excludes kit-allocated rows). Surfaced on the
   * "In custody" row.
   */
  inCustodyQuantity?: number;
  /**
   * Sum of `AssetKit.quantity` across every kit this asset participates in.
   * Surfaced on its own "In kits" row when > 0 so users see how many units
   * are earmarked for kit use — these are not free stock.
   */
  inKitsQuantity?: number;
  /**
   * Sum of `AssetLocation.quantity` across every location this asset is
   * placed at. Surfaced on its own "In locations" row when > 0; the
   * remainder (`quantity − inLocationsQuantity`) is the "unplaced" pool.
   * Does NOT subtract from `available` — placements are orthogonal to
   * custody / bookings, so a unit can be at Location X AND in custody
   * simultaneously without double-counting.
   */
  inLocationsQuantity?: number;
  /**
   * Units committed to bookings but NOT yet physically off the shelf.
   *
   * Covers two contributors:
   *  - RESERVED bookings (future bookings — naive `Σ BookingAsset.quantity`)
   *  - ONGOING/OVERDUE bookings minus the already-checked-out portion
   *    (i.e. the booked-but-not-yet-scanned-out remainder)
   *
   * Surfaced on the "Reserved (bookings)" row so users see every unit
   * spoken for by a booking that hasn't physically left yet, alongside
   * the separate "Checked out (bookings)" row for what's actually gone.
   */
  reservedQuantity?: number;
  /**
   * Units actively off the shelf via ONGOING/OVERDUE bookings — computed
   * via `computeCheckedOutForAsset` so this stays in lock-step with the
   * OUT-flow's per-slice math. Disjoint from `reservedQuantity`: every
   * booked unit appears in exactly one of the two rows.
   */
  checkedOutQuantity?: number;
  /** Whether the user has permission to adjust quantity */
  canUpdate?: boolean;
  /** Optional additional CSS class names */
  className?: string;
}

/**
 * Formats a numeric value with an optional unit suffix.
 *
 * @param value - The numeric value to display
 * @param unit - Optional unit of measure string
 * @returns Formatted string like "10 pcs" or "10"
 */
function formatWithUnit(value: number, unit: string | null): string {
  return unit ? `${value} ${unit}` : `${value}`;
}

/**
 * Renders a single row in the quantity overview card.
 *
 * @param props.label - Row label displayed on the left
 * @param props.value - Row value displayed on the right
 * @param props.warning - When true, renders the value in amber with a warning icon
 */
function OverviewRow({
  label,
  value,
  warning,
}: {
  label: string;
  value: React.ReactNode;
  warning?: boolean;
}) {
  return (
    <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3 last:border-b-0">
      <span className="text-[14px] text-gray-600">{label}</span>
      <span className="flex items-center gap-1.5 text-[14px] font-medium text-gray-900">
        {warning ? (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <TriangleAlertIcon className="size-4 text-amber-500" />
              </TooltipTrigger>
              <TooltipContent side="left">
                <p className="text-xs">
                  Low stock — the workspace owner will be notified.
                </p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        ) : null}
        {value}
      </span>
    </div>
  );
}

/**
 * Sidebar card showing quantity-tracking details for a QUANTITY_TRACKED asset.
 *
 * Displays total quantity, availability, custody count, booking reservations
 * (reserved and checked-out), unit of measure, optional low-stock threshold,
 * and consumption behavior mode. Shows a "Low Stock" badge when quantity is
 * at or below the configured minimum.
 *
 * @param props - Quantity fields from the asset record
 * @returns Card element, or null if quantity data is missing
 */
export function QuantityOverviewCard({
  assetId,
  quantity,
  unitOfMeasure,
  minQuantity,
  consumptionType,
  availableQuantity,
  custodyAvailableQuantity,
  inCustodyQuantity,
  inKitsQuantity,
  inLocationsQuantity,
  reservedQuantity,
  checkedOutQuantity,
  canUpdate = false,
  className,
}: QuantityOverviewCardProps) {
  const qty = quantity ?? 0;
  const unit = unitOfMeasure || null;
  const reserved = reservedQuantity ?? 0;
  const checkedOut = checkedOutQuantity ?? 0;
  const inKits = inKitsQuantity ?? 0;
  const inLocations = inLocationsQuantity ?? 0;
  const unplaced = Math.max(0, qty - inLocations);

  /** Use computed values from the loader, falling back to phase-1 defaults */
  const available =
    availableQuantity ??
    qty - inKits - (inCustodyQuantity ?? 0) - reserved - checkedOut;
  const inCustody = inCustodyQuantity ?? 0;

  /** Low stock when a threshold is set and available quantity is at or below it */
  const isLowStock = minQuantity != null && available <= minQuantity;

  /** Human-readable behavior label */
  const behaviorLabel =
    consumptionType === "ONE_WAY"
      ? "Used up (one-way)"
      : consumptionType === "TWO_WAY"
      ? "Returnable (two-way)"
      : "—";

  return (
    <Card className={tw("my-3 p-0", className)}>
      {/* Header */}
      <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3">
        <h3 className="text-[14px] font-semibold text-gray-900">
          Quantity Overview
        </h3>
        {canUpdate ? (
          <QuickAdjustDialog
            assetId={assetId}
            unitOfMeasure={unitOfMeasure}
            availableQuantity={custodyAvailableQuantity ?? available}
            trigger={
              <Button type="button" variant="secondary" size="sm">
                Adjust
              </Button>
            }
          />
        ) : null}
      </div>

      {/* Detail rows */}
      <OverviewRow label="Total quantity" value={formatWithUnit(qty, unit)} />
      <OverviewRow
        label="Available"
        value={formatWithUnit(available, unit)}
        warning={isLowStock}
      />
      {/* Render the kit allocation total only when the asset is actually
          in a kit. Mirrors the same conditional pattern used for "Reserved"
          / "Checked out" below — clutter-free for assets that don't belong
          to any kit. The detailed per-kit breakdown lives in the dedicated
          "Included in kits" card. */}
      {inKits > 0 ? (
        <OverviewRow label="In kits" value={formatWithUnit(inKits, unit)} />
      ) : null}
      {/* "In locations" mirrors "In kits": only renders when > 0 so
          assets with no placements stay uncluttered. Always sits next
          to "Unplaced" for the at-a-glance placed/unplaced split.
          Detailed per-location breakdown lives in the dedicated
          "Placed at locations" card. */}
      {inLocations > 0 ? (
        <OverviewRow
          label="In locations"
          value={formatWithUnit(inLocations, unit)}
        />
      ) : null}
      {inLocations > 0 && unplaced > 0 ? (
        <OverviewRow label="Unplaced" value={formatWithUnit(unplaced, unit)} />
      ) : null}
      <OverviewRow label="In custody" value={formatWithUnit(inCustody, unit)} />
      {reserved > 0 ? (
        <OverviewRow
          label="Reserved (bookings)"
          value={formatWithUnit(reserved, unit)}
        />
      ) : null}
      {checkedOut > 0 ? (
        <OverviewRow
          label="Checked out (bookings)"
          value={formatWithUnit(checkedOut, unit)}
        />
      ) : null}
      <OverviewRow label="Unit of measure" value={unit ?? "—"} />
      {minQuantity != null ? (
        <OverviewRow
          label="Min quantity (alert)"
          value={formatWithUnit(minQuantity, unit)}
        />
      ) : null}
      <OverviewRow label="Behavior" value={behaviorLabel} />
    </Card>
  );
}
