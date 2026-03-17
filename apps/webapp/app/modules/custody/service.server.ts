import type { Asset } from "@prisma/client";
import { AssetStatus } from "@prisma/client";
import { sbDb } from "~/database/supabase.server";
import { ShelfError } from "~/utils/error";

export async function releaseCustody({
  assetId,
  organizationId,
}: {
  assetId: Asset["id"];
  organizationId: Asset["organizationId"];
}) {
  try {
    // Delete the custody record for this asset
    const { error: deleteCustodyError } = await sbDb
      .from("Custody")
      .delete()
      .eq("assetId", assetId);

    if (deleteCustodyError) throw deleteCustodyError;

    // Update the asset status to AVAILABLE
    const { error: updateError } = await sbDb
      .from("Asset")
      .update({ status: AssetStatus.AVAILABLE })
      .eq("id", assetId)
      .eq("organizationId", organizationId);

    if (updateError) throw updateError;

    // Fetch the updated asset with user and custody
    const { data: asset, error: fetchError } = await sbDb
      .from("Asset")
      .select("*, user:User(firstName, lastName), custody:Custody(*)")
      .eq("id", assetId)
      .eq("organizationId", organizationId)
      .single();

    if (fetchError) throw fetchError;

    return asset;
  } catch (cause) {
    throw new ShelfError({
      cause,
      message:
        "Something went wrong while releasing the custody. Please try again or contact support.",
      additionalData: { assetId },
      label: "Custody",
    });
  }
}
