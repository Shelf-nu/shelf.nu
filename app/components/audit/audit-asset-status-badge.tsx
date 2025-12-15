import type { AuditStatusLabel } from "~/modules/audit/audit-filter-utils";

import { tw } from "~/utils/tw";

interface AuditAssetStatusBadgeProps {
  status: AuditStatusLabel;
}

/**
 * Badge component to display the audit status of an asset.
 * Shown when viewing "ALL" filter to indicate which category each asset belongs to.
 */
export function AuditAssetStatusBadge({
  status,
}: AuditAssetStatusBadgeProps) {
  const styles = {
    Expected: "bg-gray-100 text-gray-800",
    Found: "bg-success-50 text-success-700",
    Missing: "bg-warning-50 text-warning-700",
    Unexpected: "bg-error-50 text-error-700",
  };

  return (
    <span
      className={tw(
        "inline-flex items-center rounded-md px-2 py-1 text-xs font-medium",
        styles[status]
      )}
    >
      {status}
    </span>
  );
}
