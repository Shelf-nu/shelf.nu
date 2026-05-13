import type { BookingStatus, Prisma } from "@prisma/client";

export const LOCATION_WITH_HIERARCHY = {
  select: {
    id: true,
    name: true,
    parentId: true,
    _count: {
      select: {
        children: true,
      },
    },
  },
} satisfies Prisma.LocationDefaultArgs;

export const KITS_INCLUDE_FIELDS = {
  _count: { select: { assetKits: true } },
  custody: {
    select: {
      custodian: {
        select: {
          name: true,
          user: {
            select: {
              firstName: true,
              lastName: true,
              displayName: true,
              profilePicture: true,
              email: true,
            },
          },
        },
      },
    },
  },
} satisfies Prisma.KitInclude;

export const getAssetOverviewFields = (
  assetId: string,
  canUseBarcodes: boolean = false
) => {
  const baseFields = {
    category: true,
    qrCodes: true,
    tags: true,
    location: LOCATION_WITH_HIERARCHY,
    custody: {
      select: {
        createdAt: true,
        quantity: true,
        // why: kit-allocated custody rows must not be released directly
        // from the asset's custody-breakdown card. The UI uses
        // `kitCustodyId` to swap the Release button for a "held via kit"
        // badge — releasing the parent kit is the only correct path.
        kitCustodyId: true,
        kitCustody: {
          select: {
            kit: { select: { id: true, name: true } },
          },
        },
        custodian: {
          include: {
            user: true,
          },
        },
      },
    },
    organization: {
      select: {
        currency: true,
      },
    },
    customFields: {
      where: {
        customField: {
          active: true,
          deletedAt: null,
        },
      },
      include: {
        customField: {
          select: {
            id: true,
            name: true,
            helpText: true,
            required: true,
            type: true,
            categories: true,
            options: true,
          },
        },
      },
    },
    assetModel: { select: { id: true, name: true } },
    assetKits: {
      select: { kit: { select: { id: true, name: true, status: true } } },
    },
    bookingAssets: {
      where: {
        booking: {
          status: { in: ["ONGOING", "OVERDUE"] },
          // Exclude bookings where this asset has been partially checked in
          NOT: {
            partialCheckins: {
              some: {
                assetIds: { has: assetId },
              },
            },
          },
        },
      },
      include: {
        booking: {
          select: {
            id: true,
            name: true,
            from: true,
            custodianTeamMember: true,
            custodianUser: true,
          },
        },
      },
    },
  } satisfies Prisma.AssetInclude;

  if (canUseBarcodes) {
    return {
      ...baseFields,
      barcodes: {
        select: {
          id: true,
          type: true,
          value: true,
        },
      },
    } satisfies Prisma.AssetInclude;
  }

  // Always fetch barcode count so we can show a "locked" indicator
  return {
    ...baseFields,
    _count: {
      select: {
        barcodes: true,
      },
    },
  } satisfies Prisma.AssetInclude;
};

/**
 * Generates include fields for asset queries with optimized field selection
 * @param params Optional parameters to customize included fields
 * @returns Prisma include object for asset queries
 */
export const assetIndexFields = ({
  bookingFrom,
  bookingTo,
  unavailableBookingStatuses,
}: {
  bookingFrom?: Date | null;
  bookingTo?: Date | null;
  unavailableBookingStatuses?: BookingStatus[];
} = {}) => {
  const fields = {
    assetKits: { select: { kit: true } },
    category: true,
    tags: true,
    location: LOCATION_WITH_HIERARCHY,
    custody: {
      select: {
        quantity: true,
        custodian: {
          select: {
            name: true,
            userId: true,
            user: {
              select: {
                id: true,
                email: true,
                firstName: true,
                lastName: true,
                displayName: true,
                profilePicture: true,
              },
            },
          },
        },
      },
    },
    customFields: {
      where: {
        customField: {
          active: true,
          deletedAt: null,
        },
      },
      include: {
        customField: {
          select: {
            id: true,
            name: true,
            helpText: true,
            required: true,
            type: true,
            categories: true,
          },
        },
      },
    },
    qrCodes: {
      select: { id: true },
      take: 1,
    },
    /**
     * Include booking custodian data for CHECKED_OUT assets inline,
     * eliminating the N+1 re-query in updateAssetsWithBookingCustodians().
     * Only ONGOING/OVERDUE bookings have custodian info relevant to display.
     */
    bookingAssets: {
      where: {
        booking: {
          status: { in: ["ONGOING", "OVERDUE"] },
        },
      },
      take: 1,
      include: {
        booking: {
          select: {
            id: true,
            status: true,
            custodianTeamMember: true,
            custodianUser: {
              select: {
                firstName: true,
                lastName: true,
                displayName: true,
                profilePicture: true,
              },
            },
          },
        },
      },
    },
  } satisfies Prisma.AssetInclude;

  // Conditionally add bookings if date range is provided
  if (bookingTo && bookingFrom && unavailableBookingStatuses) {
    return {
      ...fields,
      bookingAssets: {
        where: {
          booking: {
            status: { in: unavailableBookingStatuses },
            OR: [
              {
                from: { lte: bookingTo },
                to: { gte: bookingFrom },
              },
              {
                from: { gte: bookingFrom },
                to: { lte: bookingTo },
              },
            ],
          },
        },
        include: {
          booking: {
            select: {
              from: true,
              to: true,
              status: true,
              id: true,
              name: true,
              // Custodian fields needed by updateAssetsWithBookingCustodians()
              custodianTeamMember: true,
              custodianUser: {
                select: {
                  firstName: true,
                  lastName: true,
                  displayName: true,
                  profilePicture: true,
                },
              },
            },
          },
        },
      },
    } satisfies Prisma.AssetInclude;
  }

  return fields;
};

export const advancedAssetIndexFields = () => {
  const fields = {
    assetKits: { select: { kit: true } },
    category: true,
    tags: true,
    location: {
      select: {
        name: true,
      },
    },
    custody: {
      select: {
        custodian: {
          select: {
            name: true,
            user: {
              select: {
                firstName: true,
                lastName: true,
                displayName: true,
                profilePicture: true,
                email: true,
              },
            },
          },
        },
      },
    },
    customFields: {
      where: {
        customField: {
          active: true,
          deletedAt: null,
        },
      },
      include: {
        customField: {
          select: {
            id: true,
            name: true,
            helpText: true,
            required: true,
            type: true,
            categories: true,
          },
        },
      },
    },
  };

  return fields;
};
