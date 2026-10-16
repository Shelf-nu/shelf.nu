import type { AuditStatus } from "@prisma/client";
import { AUDIT_STATUS_LABELS, AUDIT_STATUS_TONES } from "@shelf/labels";
import { toneBadgeColors } from "~/utils/status-tone-colors";
import { Badge } from "../shared/badge";

/**
 * Badge showing an audit session's status.
 *
 * Both halves come from `@shelf/labels`: the words from `AUDIT_STATUS_LABELS`
 * and the semantic weight from `AUDIT_STATUS_TONES`, so the companion app's
 * audit cards read the same. `toneBadgeColors` turns that tone into this app's
 * `BADGE_COLORS` hexes.
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
