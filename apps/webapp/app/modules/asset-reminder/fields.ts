import type { Prisma } from "@prisma/client";

export const ASSET_REMINDER_INCLUDE_FIELDS = {
  asset: {
    select: { id: true, title: true },
  },
  teamMembers: {
    select: {
      id: true,
      name: true,
      user: {
        select: {
          firstName: true,
          lastName: true,
          profilePicture: true,
          email: true,
          id: true,
        },
      },
    },
  },
} satisfies Prisma.AssetReminderInclude;
