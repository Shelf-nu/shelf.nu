import type { Prisma } from "@prisma/client";

export const getKitOverviewFields = (canUseBarcodes: boolean = false) => {
  if (canUseBarcodes) {
    return {
      barcodes: {
        select: {
          id: true,
          type: true,
          value: true,
        },
      },
      assets: {
        select: {
          valuation: true,
        },
      },
    } satisfies Prisma.KitInclude;
  }

  return {} satisfies Prisma.KitInclude;
};

// Keep the original for backward compatibility
export const KIT_OVERVIEW_FIELDS = getKitOverviewFields(true);
