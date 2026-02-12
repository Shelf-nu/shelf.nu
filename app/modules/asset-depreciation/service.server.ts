import type { AssetDepreciation } from "@prisma/client";
import { db } from "~/database/db.server";
import { ShelfError } from "~/utils/error";

const label = "Assets";

export async function getAssetDepreciation({ assetId }: { assetId: string }) {
  try {
    return await db.assetDepreciation.findUnique({
      where: { assetId },
    });
  } catch (cause) {
    throw new ShelfError({
      cause,
      message: "Failed to fetch asset depreciation settings.",
      additionalData: { assetId },
      label,
    });
  }
}

export async function upsertAssetDepreciation({
  assetId,
  depreciationRate,
  period,
  startDate,
  residualValue,
}: {
  assetId: string;
  depreciationRate: AssetDepreciation["depreciationRate"];
  period: AssetDepreciation["period"];
  startDate: AssetDepreciation["startDate"];
  residualValue: AssetDepreciation["residualValue"];
}) {
  try {
    return await db.assetDepreciation.upsert({
      where: { assetId },
      create: {
        assetId,
        depreciationRate,
        period,
        startDate,
        residualValue,
      },
      update: {
        depreciationRate,
        period,
        startDate,
        residualValue,
      },
    });
  } catch (cause) {
    throw new ShelfError({
      cause,
      message: "Failed to save asset depreciation settings.",
      additionalData: {
        assetId,
        depreciationRate,
        period,
        startDate,
        residualValue,
      },
      label,
    });
  }
}
