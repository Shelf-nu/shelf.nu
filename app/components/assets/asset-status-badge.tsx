import { AssetStatus } from "@prisma/client";
import { useTheme } from "~/hooks/use-theme";
import { Badge } from "../shared/badge";
import { UnavailableBadge } from "../shared/unavailable-badge";

export const userFriendlyAssetStatus = (status: AssetStatus) => {
  switch (status) {
    case AssetStatus.IN_CUSTODY:
      return "In custody";
    case AssetStatus.CHECKED_OUT:
      return "Checked out";
    default:
      return "Available";
  }
};

export const assetStatusColorMap = (status: AssetStatus, theme: "light" | "dark" = "light") => {
  switch (status) {
    case AssetStatus.IN_CUSTODY:
      return theme === "dark" ? "#60A5FA" : "#2E90FA"; // Lighter blue for dark mode
    case AssetStatus.CHECKED_OUT:
      return theme === "dark" ? "#A78BFA" : "#5925DC"; // Much lighter purple for dark mode
    default:
      return theme === "dark" ? "#34D399" : "#12B76A"; // Lighter green for dark mode
  }
};

export function AssetStatusBadge({
  status,
  availableToBook = true,
}: {
  status: AssetStatus;
  availableToBook: boolean;
}) {
  const theme = useTheme();
  
  // If the asset is not available to book, it is unavailable
  // We handle this on front-end as syncing status with the flag is very complex on backend and error prone so this is the lesser evil
  return (
    <div className="flex items-center gap-[6px]">
      <Badge color={assetStatusColorMap(status, theme)}>
        {userFriendlyAssetStatus(status)}
      </Badge>
      {!availableToBook && (
        <UnavailableBadge title="This asset is marked as unavailable for bookings" />
      )}
    </div>
  );
}
