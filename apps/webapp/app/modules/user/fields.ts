import type { Prisma } from "@prisma/client";

export const USER_WITH_SSO_DETAILS_SELECT = {
  id: true,
  email: true,
  firstName: true,
  lastName: true,
  sso: true,
  userOrganizations: {
    select: {
      roles: true,
      organization: {
        select: {
          id: true,
          name: true,
          enabledSso: true,
          ssoDetails: {
            select: {
              id: true,
              domain: true,
              baseUserGroupId: true,
              selfServiceGroupId: true,
              adminGroupId: true,
            },
          },
        },
      },
    },
  },
} satisfies Prisma.UserSelect;
