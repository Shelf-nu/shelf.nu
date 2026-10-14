import type { Prisma } from "@prisma/client";

export const ASSET_REMINDER_INCLUDE_FIELDS = {
  asset: {
    // `archivedAt` so lists can mark a reminder whose asset is archived: the
    // worker skips it while the asset stays archived.
    select: { id: true, title: true, archivedAt: true },
  },
  teamMembers: {
    select: {
      id: true,
      name: true,
      user: {
        select: {
          firstName: true,
          lastName: true,
          displayName: true,
          profilePicture: true,
          email: true,
          id: true,
        },
      },
    },
  },
} satisfies Prisma.AssetReminderInclude;
