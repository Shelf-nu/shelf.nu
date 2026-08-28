import type { Prisma } from "@prisma/client";

/**
 * The columns `resolveUserDisplayName` reads.
 *
 * Spread this into any `select` that feeds a rendered name, instead of listing
 * `firstName`/`lastName` by hand — a select missing `displayName` produces a
 * row that resolves to the user's legal name with no error anywhere.
 *
 * @see {@link file://./../../utils/user.ts} — `UserNameFields`, the matching
 *   type the resolvers require.
 */
export const USER_NAME_SELECT = {
  firstName: true,
  lastName: true,
  displayName: true,
} as const satisfies Prisma.UserSelect;

export const USER_WITH_SSO_DETAILS_SELECT = {
  id: true,
  email: true,
  firstName: true,
  lastName: true,
  displayName: true,
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
