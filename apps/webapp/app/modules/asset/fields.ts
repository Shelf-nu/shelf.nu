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
  _count: { select: { assets: true } },
  custody: {
    select: {
      custodian: {
        select: {
          name: true,
          user: {
            select: {
              firstName: true,
              lastName: true,
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
          },
        },
      },
    },
    kit: { select: { id: true, name: true, status: true } },
    bookings: {
      where: {
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
      select: {
        id: true,
        name: true,
        from: true,
        custodianTeamMember: true,
        custodianUser: true,
      },
    },
  } satisfies Prisma.AssetInclude;

  // Conditionally add barcodes if enabled
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

  return baseFields;
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
    kit: true,
    category: true,
    tags: true,
    location: LOCATION_WITH_HIERARCHY,
    custody: {
      select: {
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
  } satisfies Prisma.AssetInclude;

  // Conditionally add bookings if date range is provided
  if (bookingTo && bookingFrom && unavailableBookingStatuses) {
    return {
      ...fields,
      bookings: {
        where: {
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
        select: {
          from: true,
          to: true,
          status: true,
          id: true,
          name: true,
        },
      },
    } satisfies Prisma.AssetInclude;
  }

  return fields;
};

export const advancedAssetIndexFields = () => {
  const fields = {
    kit: true,
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
