import type { AuditStatus } from "@prisma/client";
import { BADGE_COLORS } from "~/utils/badge-colors";
import { AuditStatusBadge } from "./audit-status-badge";
import { Badge } from "../shared/badge";

type AuditStatusBadgeWithOverdueProps = {
  status: AuditStatus;
  dueDate?: Date | null;
};

/**
 * Component that displays the audit status badge and an additional "Overdue" badge
 * if the audit is past its due date and not yet completed or cancelled.
 *
 * @param status - The current audit status
 * @param dueDate - The audit due date (UTC timestamp from database)
 */
export function AuditStatusBadgeWithOverdue({
  status,
  dueDate,
}: AuditStatusBadgeWithOverdueProps) {
  // Check if audit is overdue
  const isOverdue =
    dueDate &&
    status !== "COMPLETED" &&
    status !== "CANCELLED" &&
    new Date(dueDate) < new Date();

  return (
    <div className="flex items-center gap-2">
      <AuditStatusBadge status={status} />
      {isOverdue && (
        <Badge
          color={BADGE_COLORS.red.bg}
          textColor={BADGE_COLORS.red.text}
          withDot={false}
        >
          <span className="block whitespace-nowrap">Overdue</span>
        </Badge>
      )}
    </div>
  );
}
