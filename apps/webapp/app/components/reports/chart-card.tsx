/**
 * Chart Card Component
 *
 * Container wrapper for charts in reports. Provides consistent styling
 * with header, optional controls, and proper spacing.
 *
 * @see {@link file://./area-chart.tsx}
 * @see {@link file://./bar-chart.tsx}
 */

import type { ReactNode } from "react";

import { tw } from "~/utils/tw";

export interface ChartCardProps {
  /** Chart title */
  title: string;
  /** Optional subtitle or description */
  subtitle?: string;
  /** Optional badge text (e.g., timeframe) - displays with orange accent */
  badge?: string;
  /** Chart content */
  children: ReactNode;
  /** Optional controls (e.g., toggle buttons) */
  controls?: ReactNode;
  /** Chart height */
  height?: number;
  /** Additional CSS classes */
  className?: string;
}

/**
 * Chart container with title and optional controls.
 *
 * Styling follows the monochrome, compact report aesthetic.
 */
export function ChartCard({
  title,
  subtitle,
  badge,
  children,
  controls,
  height = 300,
  className,
}: ChartCardProps) {
  return (
    <div className={tw("rounded border border-gray-200 bg-white", className)}>
      {/* Header */}
      <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3">
        <div className="flex items-center gap-3">
          <h3 className="text-sm font-semibold text-gray-900">{title}</h3>
          {badge && (
            <span className="rounded-full bg-primary-50 px-2 py-0.5 text-xs font-medium text-primary-600">
              {badge}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {subtitle && <p className="text-xs text-gray-500">{subtitle}</p>}
          {controls}
        </div>
      </div>

      {/* Chart */}
      <div className="p-4" style={{ height }}>
        {children}
      </div>
    </div>
  );
}

export default ChartCard;
