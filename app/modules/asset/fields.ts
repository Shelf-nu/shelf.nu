import type { Prisma } from "@prisma/client";

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

export const ASSET_INCLUDE_FIELDS = {
  category: true,
  notes: {
    orderBy: { createdAt: "desc" },
    include: {
      user: {
        select: {
          firstName: true,
          lastName: true,
        },
      },
    },
  },
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
