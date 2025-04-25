import { KitStatus, type Prisma } from "@prisma/client";

export function getShareAgreementUrl(
  asset: Prisma.AssetGetPayload<{
    select: { id: true; kit: { select: { id: true; status: true } } };
  }>
) {
  /**
   * If the kit is in custody or pending signature, that means that the asset
   * is assigned custody via the kit. Otherwise it is an individual custody.
   */
  return asset?.kit &&
    (asset.kit.status === KitStatus.IN_CUSTODY ||
      asset.kit.status === KitStatus.SIGNATURE_PENDING)
    ? `/kits/${asset.kit.id}/share-agreement`
    : `/assets/${asset.id}/overview/share-agreement`;
}
