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
import { InfoTooltip } from "~/components/shared/info-tooltip";
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
   * Current physical availability (total - inCustody - inKits -
   * checkedOut), shown on the "Available" row. Deliberately window-agnostic
   * — it reflects what's on the shelf RIGHT NOW and is never reduced by
   * future booking reservations (see the "Reserved (bookings)" row below
   * for those). This is the #2724 fix: the headline must never go negative
   * just because far-future reservations exist.
   */
  availableQuantity?: number;
  /**
   * Physical availability. Used as the cap for the QuickAdjustDialog's
   * "Remove" operation. As of the #2724 fix this is numerically identical
   * to `availableQuantity` (both source from the same `physicalAvailable`
   * primitive field) — kept as a separate prop only so existing call sites
   * don't need to change. Falls back to `availableQuantity` when not
   * provided.
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
   * Sum of MANUAL placements only (`AssetLocation.assetKitId IS NULL`).
   *
   * Drives the placed / unplaced / over-placed split, because this is the
   * sum `enforce_asset_location_sum_within_total` actually bounds: since
   * `20260602100000_assetlocation_sum_exclude_kit_driven` the trigger ignores
   * kit-driven rows, which are bounded on their own axis by
   * `enforce_asset_kit_sum_within_total`. Using {@link inLocationsQuantity}
   * here instead would report a valid asset (80 manual + 50 kit-driven units
   * of a 100 total) as over-allocated. Falls back to `inLocationsQuantity`
   * when absent, which is exact for the (common) asset with no kits.
   */
  inLocationsManualQuantity?: number;
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
   * Count of distinct upcoming bookings contributing to `reservedQuantity`.
   * Used only by the explanatory tooltip next to the "Reserved (bookings)"
   * row — see {@link QuantityOverviewCardProps.reservedQuantity}.
   */
  reservingBookingCount?: number;
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
 * @param props.warningMessage - Text inside the warning tooltip; defaults to the low-stock wording
 * @param props.labelTooltip - Optional explanatory tooltip rendered next to the label (e.g. `InfoTooltip`)
 */
function OverviewRow({
  label,
  value,
  warning,
  warningMessage = "Low stock — the workspace owner will be notified.",
  labelTooltip,
}: {
  label: string;
  value: React.ReactNode;
  warning?: boolean;
  warningMessage?: string;
  labelTooltip?: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3 last:border-b-0">
      <span className="flex items-center gap-1.5 text-[14px] text-gray-600">
        {label}
        {labelTooltip}
      </span>
      <span className="flex items-center gap-1.5 text-[14px] font-medium text-gray-900">
        {warning ? (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <TriangleAlertIcon className="size-4 text-amber-500" />
              </TooltipTrigger>
              <TooltipContent side="left">
                <p className="text-xs">{warningMessage}</p>
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
  inLocationsManualQuantity,
  reservedQuantity,
  reservingBookingCount,
  checkedOutQuantity,
  canUpdate = false,
  className,
}: QuantityOverviewCardProps) {
  const qty = quantity ?? 0;
  const unit = unitOfMeasure || null;
  const reserved = reservedQuantity ?? 0;
  const bookingCount = reservingBookingCount ?? 0;
  const checkedOut = checkedOutQuantity ?? 0;
  const inKits = inKitsQuantity ?? 0;
  const inLocations = inLocationsQuantity ?? 0;
  const inLocationsManual = inLocationsManualQuantity ?? inLocations;
  const unplaced = Math.max(0, qty - inLocations);
  /**
   * The honest negative side of the residual, computed on the MANUAL axis
   * because that is the one `enforce_asset_location_sum_within_total` bounds
   * (kit-driven rows live on their own axis, so 80 manual + 50 kit-driven of
   * 100 is valid and must not read as over-placed).
   *
   * A positive value means manual placements claim more units than the asset
   * owns, which is a state the app can reach on its own: a consume lowers
   * `Asset.quantity` without touching placements once the unplaced residual
   * is gone. It used to surface as a clamped "Unplaced 0" — a number that was
   * never true, hiding the drift from the only person who could correct it.
   */
  const overPlacedBy = Math.max(0, inLocationsManual - qty);

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
      {/* Over-placed is the negative side of the same residual. It gets its
          own row rather than a negative "Unplaced" because the number is not
          spare stock — it is a placement figure that has outrun the total and
          needs a human to say which location actually lost the units. */}
      {overPlacedBy > 0 ? (
        <OverviewRow
          label="Over-placed"
          value={formatWithUnit(overPlacedBy, unit)}
          warning
          warningMessage={`Locations claim ${formatWithUnit(
            overPlacedBy,
            unit
          )} more than this asset's total. Open "Manage placements" and lower the location that lost them.`}
        />
      ) : null}
      <OverviewRow label="In custody" value={formatWithUnit(inCustody, unit)} />
      {reserved > 0 ? (
        <OverviewRow
          label="Reserved (bookings)"
          value={formatWithUnit(reserved, unit)}
          labelTooltip={
            <InfoTooltip
              content={
                <p className="text-xs">
                  {reserved} {unit || "units"} reserved across {bookingCount}{" "}
                  upcoming {bookingCount === 1 ? "booking" : "bookings"}. These
                  are committed for future dates and don&apos;t reduce
                  what&apos;s physically on the shelf now.
                </p>
              }
            />
          }
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
