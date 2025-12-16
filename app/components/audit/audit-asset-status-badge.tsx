import type { AuditStatusLabel } from "~/modules/audit/audit-filter-utils";

import { BADGE_COLORS, type BadgeColorScheme } from "~/utils/badge-colors";
import { Badge } from "../shared/badge";

interface AuditAssetStatusBadgeProps {
  status: AuditStatusLabel;
}

const auditStatusColorMap = (status: AuditStatusLabel): BadgeColorScheme => {
  switch (status) {
    case "Expected":
      return BADGE_COLORS.gray;
    case "Found":
      return BADGE_COLORS.green;
    case "Missing":
      return BADGE_COLORS.amber;
    case "Unexpected":
      return BADGE_COLORS.red;
  }
};

/**
 * Badge component to display the audit status of an asset.
 * Shown when viewing "ALL" filter to indicate which category each asset belongs to.
 */
export function AuditAssetStatusBadge({ status }: AuditAssetStatusBadgeProps) {
  const colors = auditStatusColorMap(status);

  return (
    <Badge color={colors.bg} textColor={colors.text}>
      {status}
    </Badge>
  );
}
