/**
 * Quantity Overview Card
 *
 * Displays a summary of quantity-tracking information for QUANTITY_TRACKED assets
 * on the asset detail overview page. Shows total quantity, available units,
 * units in custody, unit of measure, optional low-stock alert threshold,
 * and the consumption behavior mode.
 *
 * Availability and in-custody values are computed by the loader from actual
 * custody records and passed as props. Falls back to total/0 if not provided.
 *
 * @see {@link file://./../../routes/_layout+/assets.$assetId.overview.tsx} - Asset overview page
 * @see {@link file://./asset-custody-card.tsx} - Similar sidebar card pattern
 */

import type React from "react";
import type { ConsumptionType } from "@prisma/client";
import { Badge } from "~/components/shared/badge";
import { Button } from "~/components/shared/button";
import { Card } from "~/components/shared/card";
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
  /** Computed available quantity (total - inCustody), provided by the loader */
  availableQuantity?: number;
  /** Computed quantity currently in custody, provided by the loader */
  inCustodyQuantity?: number;
  /** Whether the user has permission to adjust quantity */
  canUpdate?: boolean;
  /** When true, the quick-adjust dialog opens automatically (e.g., QR scan) */
  autoOpenAdjust?: boolean;
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
 */
function OverviewRow({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3 last:border-b-0">
      <span className="text-[14px] text-gray-600">{label}</span>
      <span className="text-[14px] font-medium text-gray-900">{value}</span>
    </div>
  );
}

/**
 * Sidebar card showing quantity-tracking details for a QUANTITY_TRACKED asset.
 *
 * Displays total quantity, availability, custody count, unit of measure,
 * optional low-stock threshold, and consumption behavior mode. Shows a
 * "Low Stock" badge when quantity is at or below the configured minimum.
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
  inCustodyQuantity,
  canUpdate = false,
  autoOpenAdjust = false,
  className,
}: QuantityOverviewCardProps) {
  const qty = quantity ?? 0;
  const unit = unitOfMeasure || null;

  /** Use computed values from the loader, falling back to phase-1 defaults */
  const available = availableQuantity ?? qty;
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
        <div className="flex items-center gap-2">
          <h3 className="text-[14px] font-semibold text-gray-900">
            Quantity Overview
          </h3>
          {isLowStock ? (
            <Badge color="#f59e0b" withDot={false}>
              Low Stock
            </Badge>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[14px] font-medium text-gray-700">
            {available} / {formatWithUnit(qty, unit)}
          </span>
          {canUpdate ? (
            <QuickAdjustDialog
              assetId={assetId}
              unitOfMeasure={unitOfMeasure}
              autoOpen={autoOpenAdjust}
              trigger={
                <Button type="button" variant="secondary" size="sm">
                  Adjust
                </Button>
              }
            />
          ) : null}
        </div>
      </div>

      {/* Detail rows */}
      <OverviewRow label="Total quantity" value={formatWithUnit(qty, unit)} />
      <OverviewRow label="Available" value={formatWithUnit(available, unit)} />
      <OverviewRow label="In custody" value={formatWithUnit(inCustody, unit)} />
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
