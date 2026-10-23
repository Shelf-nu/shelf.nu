import {
  AUDIT_ASSET_STATUS_LABELS,
  AUDIT_ASSET_STATUS_TONES,
} from "@shelf/labels";
import type { AuditStatusLabel } from "~/modules/audit/audit-filter-utils";

import { toneBadgeColors } from "~/utils/status-tone-colors";
import { Badge } from "../shared/badge";

interface AuditAssetStatusBadgeProps {
  status: AuditStatusLabel;
}

/**
 * Maps the displayed words back to the stored status, so the badge can look up
 * the shared tone. The component receives an `AuditStatusLabel` — the label,
 * not the enum — and "Not scanned" and "Missing" are the same PENDING row
 * before and after the audit closes.
 */
const STATUS_BY_LABEL: Record<
  AuditStatusLabel,
  keyof typeof AUDIT_ASSET_STATUS_TONES
> = {
  [AUDIT_ASSET_STATUS_LABELS.PENDING]: "PENDING",
  [AUDIT_ASSET_STATUS_LABELS.FOUND]: "FOUND",
  [AUDIT_ASSET_STATUS_LABELS.MISSING]: "MISSING",
  [AUDIT_ASSET_STATUS_LABELS.UNEXPECTED]: "UNEXPECTED",
};

/**
 * Badge showing one asset's outcome within an audit.
 *
 * Shown under the "ALL" filter, where rows of every outcome are mixed together.
 * The colour comes from the tone `@shelf/labels` assigns the status, so the
 * companion app's scan list ranks the same outcomes the same way.
 */
export function AuditAssetStatusBadge({ status }: AuditAssetStatusBadgeProps) {
  const colors = toneBadgeColors(
    AUDIT_ASSET_STATUS_TONES[STATUS_BY_LABEL[status]]
  );

  return (
    <Badge color={colors.bg} textColor={colors.text} withDot={false}>
      {status}
    </Badge>
  );
}
