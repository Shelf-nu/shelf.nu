/**
 * Archived Badge
 *
 * A small "Archived" chip shown next to an asset that has been archived
 * (soft-removed from default views, reinstatable). It is rendered ALONGSIDE
 * the normal {@link AssetStatusBadge} rather than replacing the status, because
 * archiving is orthogonal to an asset's live AVAILABLE/IN_CUSTODY/CHECKED_OUT
 * status (see issue #382 and `Asset.archivedAt`).
 *
 * Used on surfaces where an archived asset still legitimately appears, e.g. the
 * "Archived" index view and historical/completed bookings, so it reads clearly
 * as out-of-circulation rather than 404-ing or silently vanishing.
 *
 * @see {@link file://./asset-status-badge/asset-status-badge.tsx}
 */

import { BADGE_COLORS } from "~/utils/badge-colors";
import { Badge } from "../shared/badge";

/**
 * Renders the gray "Archived" chip.
 *
 * @param props.className - Optional extra classes forwarded to the Badge.
 */
export function ArchivedBadge({ className }: { className?: string }) {
  return (
    <Badge
      color={BADGE_COLORS.gray.bg}
      textColor={BADGE_COLORS.gray.text}
      withDot={false}
      className={className}
    >
      Archived
    </Badge>
  );
}
