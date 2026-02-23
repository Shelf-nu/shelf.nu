import { KitStatus } from "@prisma/client";
import { BADGE_COLORS, type BadgeColorScheme } from "~/utils/badge-colors";
import type { ExtendedKitStatus } from "~/utils/booking-assets";
import { Badge } from "../shared/badge";
import { UnavailableBadge } from "../shared/unavailable-badge";

export function userFriendlyKitStatus(status: ExtendedKitStatus) {
  switch (status) {
    case KitStatus.IN_CUSTODY:
      return "In Custody";
    case KitStatus.CHECKED_OUT:
      return "Checked Out";
    case "PARTIALLY_CHECKED_IN":
      return "Already checked in";
    default:
      return "Available";
  }
}

export const kitStatusColorMap = (
  status: ExtendedKitStatus
): BadgeColorScheme => {
  switch (status) {
    case KitStatus.IN_CUSTODY:
      return BADGE_COLORS.blue;
    case "PARTIALLY_CHECKED_IN":
      return BADGE_COLORS.blue;
    case KitStatus.CHECKED_OUT:
      return BADGE_COLORS.violet;
    default:
      // AVAILABLE
      return BADGE_COLORS.green;
  }
};

export function KitStatusBadge({
  status,
  availableToBook = true,
}: {
  status: ExtendedKitStatus;
  availableToBook: boolean;
}) {
  const colors = kitStatusColorMap(status);
  return (
    <div className="flex items-center gap-[6px]">
      <Badge color={colors.bg} textColor={colors.text}>
        {userFriendlyKitStatus(status)}
      </Badge>
      {!availableToBook && (
        <UnavailableBadge title="This kit is not available for Bookings because some of its assets are marked as unavailable" />
      )}
    </div>
  );
}
