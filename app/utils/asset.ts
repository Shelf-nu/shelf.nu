import type { Asset } from "@prisma/client";

export function getShareAgreementUrl(asset: Pick<Asset, "id" | "kitId">) {
  return asset.kitId
    ? `/kits/${asset.kitId}/share-agreement`
    : `/assets/${asset.id}/overview/share-agreement`;
}
