import type { BookingStatus, Prisma } from "@prisma/client";

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

export const ASSET_OVERVIEW_FIELDS = {
  category: true,
  qrCodes: true,
  tags: true,
  location: true,
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
            userId: true,
            user: {
              select: {
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
        take: 1,
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
