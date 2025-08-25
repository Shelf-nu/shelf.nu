import type { Prisma } from "@prisma/client";

export const getKitOverviewFields = (canUseBarcodes: boolean = false) => {
  const fields: Prisma.KitInclude = {
    assets: {
      select: {
        valuation: true,
      },
    },
    category: {
      select: {
        id: true,
        name: true,
        color: true,
      },
    },
    location: true,
  };

  if (canUseBarcodes) {
    fields.barcodes = {
      select: {
        id: true,
        type: true,
        value: true,
      },
    };
  }

  return fields;
};

// Keep the original for backward compatibility
export const KIT_OVERVIEW_FIELDS = getKitOverviewFields(true);
