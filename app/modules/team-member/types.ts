import type { Prisma } from "@prisma/client";

export type TeamMemberWithUser = Prisma.TeamMemberGetPayload<{
  include: {
    user: true;
  };
}>;
