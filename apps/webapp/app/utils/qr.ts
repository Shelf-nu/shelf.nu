import type { Asset, Kit } from "@prisma/client";
/** This function takes a QR and normalizes the related object data
 */
export function normalizeQrData(qr: {
  id: string;
  assetId?: string | null;
  kitId?: string | null;
  asset?: Partial<Pick<Asset, "id" | "title">> | null; // Use Partial and Pick to relax requirements
  kit?: Partial<Pick<Kit, "id" | "name">> | null; // Use Partial and Pick to relax requirements
}): {
  item: Asset | Kit | null;
  type: "asset" | "kit" | null;
  normalizedName: string;
} {
  let item: Asset | Kit | null = null;
  let type: "asset" | "kit" | null = null;
  let normalizedName = "";

  if (qr.assetId) {
    type = "asset";
    item = qr.asset as Asset;
    normalizedName = item.title;
  } else if (qr.kitId && qr.kit) {
    type = "kit";
    item = qr.kit as Kit;
    normalizedName = item.name;
  }

  return {
    item,
    type,
    normalizedName,
  };
}
