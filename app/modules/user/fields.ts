import type { Prisma } from "@prisma/client";

export const INCLUDE_SSO_DETAILS_VIA_USER_ORGANIZATION = {
  userOrganizations: {
    include: {
      organization: {
        include: {
          ssoDetails: true,
        },
      },
    },
  },
} satisfies Prisma.UserInclude;
