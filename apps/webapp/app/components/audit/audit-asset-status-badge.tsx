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
 * Maps the displayed words back to the stored status so the shared tone map is
 * the single source of colour. `AuditStatusLabel` is the label, not the enum —
 * "Not scanned" and "Missing" are the same PENDING row before and after the
 * audit closes.
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
 * Badge component to display the audit status of an asset.
 * Shown when viewing "ALL" filter to indicate which category each asset belongs to.
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
