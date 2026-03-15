export const getKitOverviewFields = (canUseBarcodes: boolean = false) => {
  const fields: Record<string, unknown> = {
    assets: {
      select: {
        valuation: true,
      },
    },
    qrCodes: {
      select: {
        id: true,
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
