/**
 * Quantity Overview Card
 *
 * Displays a summary of quantity-tracking information for QUANTITY_TRACKED assets
 * on the asset detail overview page. Shows total quantity, available units,
 * units in custody, unit of measure, optional low-stock alert threshold,
 * and the consumption behavior mode.
 *
 * Phase 1: "Available" mirrors total quantity and "In custody" is hardcoded to 0.
 * Phase 2 will compute these from actual booking/checkout data.
 *
 * @see {@link file://./../../routes/_layout+/assets.$assetId.overview.tsx} - Asset overview page
 * @see {@link file://./asset-custody-card.tsx} - Similar sidebar card pattern
 */

import type React from "react";
import type { ConsumptionType } from "@prisma/client";
import { Badge } from "~/components/shared/badge";
import { Card } from "~/components/shared/card";
import { tw } from "~/utils/tw";

/** Props for the QuantityOverviewCard component */
export interface QuantityOverviewCardProps {
  /** Total quantity of the asset */
  quantity: number | null;
  /** Unit of measure label (e.g., "pcs", "boxes", "liters") */
  unitOfMeasure: string | null;
  /** Low-stock alert threshold; when quantity <= minQuantity, a warning badge appears */
  minQuantity: number | null;
  /** Consumption behavior: ONE_WAY (used up) or TWO_WAY (returnable) */
  consumptionType: ConsumptionType | null;
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
  quantity,
  unitOfMeasure,
  minQuantity,
  consumptionType,
  className,
}: QuantityOverviewCardProps) {
  const qty = quantity ?? 0;
  const unit = unitOfMeasure || null;

  /** Low stock when a threshold is set and current quantity is at or below it */
  const isLowStock =
    minQuantity != null && quantity != null && quantity <= minQuantity;

  /** Phase 1: available mirrors total; in-custody is hardcoded to 0 */
  const available = qty;
  const inCustody = 0;

  /** Human-readable behavior label */
  const behaviorLabel =
    consumptionType === "ONE_WAY"
      ? "Used up (one-way)"
      : "Returnable (two-way)";

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
        <span className="text-[14px] font-medium text-gray-700">
          {formatWithUnit(qty, unit)}
        </span>
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
