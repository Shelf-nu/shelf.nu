import type { Prisma } from "@prisma/client";

export type BookingForEmail = Prisma.BookingGetPayload<{
  include: {
    custodianTeamMember: true;
    custodianUser: true;
    organization: {
      include: {
        owner: {
          select: { email: true };
        };
      };
    };
    _count: {
      select: { assets: true };
    };
  };
}>;
