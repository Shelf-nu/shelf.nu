/**
 * Report Icon
 *
 * Renders the Lucide icon a report names in the registry (`ReportDefinition.icon`),
 * falling back to a plain document icon for a name this map does not hold. Shared
 * by the report cards on the reports index and the report list on the unlock page.
 *
 * The icons are listed one by one, never imported as the whole `lucide-react`
 * namespace: a namespace lookup keeps every Lucide icon in the bundle. A report
 * that names a new icon adds it to `REPORT_ICONS`, which `report-icon.test.ts`
 * checks against the registry.
 *
 * @see {@link file://../../modules/reports/registry.ts}
 * @see {@link file://../../routes/_layout+/reports._index.tsx}
 * @see {@link file://./unlock-reports-page.tsx}
 */

import {
  Activity,
  AlertTriangle,
  BarChart3,
  Boxes,
  ClipboardCheck,
  Clock,
  FileText,
  LayoutGrid,
  Package,
  PieChart,
  TrendingUp,
  Users,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

/** The icons reports can name, keyed by the component name the registry stores. */
export const REPORT_ICONS: Record<string, LucideIcon> = {
  Activity,
  AlertTriangle,
  BarChart3,
  Boxes,
  ClipboardCheck,
  Clock,
  LayoutGrid,
  Package,
  PieChart,
  TrendingUp,
  Users,
};

/**
 * The icon for one report.
 *
 * @param props.name - The Lucide component name from the report's registry entry
 * @param props.className - Classes for the rendered svg
 */
export function ReportIcon({
  name,
  className,
}: {
  name: string;
  className?: string;
}) {
  const Icon = REPORT_ICONS[name] ?? FileText;
  return <Icon className={className} aria-hidden="true" />;
}
