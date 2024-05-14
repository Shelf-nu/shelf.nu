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
              profilePicture: true,
            },
          },
        },
      },
    },
  },
} satisfies Prisma.KitInclude;
