import type { AuditStatus } from "@prisma/client";
import { AUDIT_STATUS_LABELS, AUDIT_STATUS_TONES } from "@shelf/labels";
import { toneBadgeColors } from "~/utils/status-tone-colors";
import { Badge } from "../shared/badge";

/**
 * Badge component for displaying audit status with appropriate colors.
 * Colors are sourced from the platform's consistent BADGE_COLORS palette;
 * the words come from `@shelf/labels` so the companion app's audit cards can
 * never show a different one. This file used to carry a byte-identical local
 * copy of that map.
 *
 * @param status - The audit status from Prisma enum
 */
export function AuditStatusBadge({ status }: { status: AuditStatus }) {
  const colors = toneBadgeColors(AUDIT_STATUS_TONES[status]);

  return (
    <Badge color={colors.bg} textColor={colors.text} withDot={false}>
      {/* why: no `lowercase first-letter:uppercase` — AUDIT_STATUS_LABELS is
          already sentence-cased display text, and the transform would mangle
          any future label with an internal capital. */}
      <span className="block whitespace-nowrap">
        {AUDIT_STATUS_LABELS[status]}
      </span>
    </Badge>
  );
}
