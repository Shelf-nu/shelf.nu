import { AssetStatus } from "@prisma/client";

export const userFriendlyAssetStatus = (status: AssetStatus) => {
  switch (status) {
    case AssetStatus.IN_CUSTODY:
      return "In custody";

    default:
      return "Available";
  }
};
