import type { AuditStatus } from "@prisma/client";
import { BADGE_COLORS, type BadgeColorScheme } from "~/utils/badge-colors";
import { Badge } from "../shared/badge";

const auditStatusColorMap: Record<AuditStatus, BadgeColorScheme> = {
  PENDING: BADGE_COLORS.gray,
  ACTIVE: BADGE_COLORS.violet,
  COMPLETED: BADGE_COLORS.green,
  CANCELLED: BADGE_COLORS.gray,
};

const auditStatusLabels: Record<AuditStatus, string> = {
  PENDING: "Pending",
  ACTIVE: "Active",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
};

/**
 * Badge component for displaying audit status with appropriate colors.
 * Colors are sourced from the platform's consistent BADGE_COLORS palette.
 *
 * @param status - The audit status from Prisma enum
 */
export function AuditStatusBadge({ status }: { status: AuditStatus }) {
  const colors = auditStatusColorMap[status];

  return (
    <Badge color={colors.bg} textColor={colors.text} withDot={false}>
      <span className="block whitespace-nowrap lowercase first-letter:uppercase">
        {auditStatusLabels[status]}
      </span>
    </Badge>
  );
}
