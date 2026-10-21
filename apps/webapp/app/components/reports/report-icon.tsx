/**
 * Report Icon
 *
 * Renders the Lucide icon a report names in the registry (`ReportDefinition.icon`),
 * falling back to a plain document icon for a name Lucide does not have. Shared
 * by the report cards on the reports index and the report list on the unlock page.
 *
 * @see {@link file://../../modules/reports/registry.ts}
 * @see {@link file://../../routes/_layout+/reports._index.tsx}
 * @see {@link file://./unlock-reports-page.tsx}
 */

import type React from "react";
import * as LucideIcons from "lucide-react";

/** Every Lucide export, keyed by the component name the registry stores. */
const LUCIDE_ICONS = LucideIcons as unknown as Record<
  string,
  React.ComponentType<{ className?: string }>
>;

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
  const Icon = LUCIDE_ICONS[name] || LucideIcons.FileText;
  return <Icon className={className} aria-hidden="true" />;
}
