import type { Organization, User } from "@prisma/client";
import { Prisma, Roles, OrganizationRoles } from "@prisma/client";
import type { ITXClientDenyList } from "@prisma/client/runtime/library";
import { PrismaClientKnownRequestError } from "@prisma/client/runtime/library";
import type { LoaderFunctionArgs } from "@remix-run/node";
import sharp from "sharp";
import type { AuthSession } from "server/session";
import { config } from "~/config/shelf.config";
import type { ExtendedPrismaClient } from "~/database/db.server";
import { db } from "~/database/db.server";

import { sendEmail } from "~/emails/mail.server";
import { getSupabaseAdmin } from "~/integrations/supabase/client";
import {
  deleteAuthAccount,
  createEmailAuthAccount,
  signInWithEmail,
  updateAccountPassword,
} from "~/modules/auth/service.server";

import { dateTimeInUnix } from "~/utils/date-time-in-unix";
import type { ErrorLabel } from "~/utils/error";
import { ShelfError, isLikeShelfError } from "~/utils/error";
import type { ValidationError } from "~/utils/http";
import { getCurrentSearchParams } from "~/utils/http.server";
import { id as generateId } from "~/utils/id/id.server";
import { getParamsValues } from "~/utils/list";
import { Logger } from "~/utils/logger";
import { getRoleFromGroupId } from "~/utils/roles.server";
import {
  deleteProfilePicture,
  getPublicFileURL,
  parseFileFormData,
} from "~/utils/storage.server";
import { randomUsernameFromEmail } from "~/utils/user";
import { INCLUDE_SSO_DETAILS_VIA_USER_ORGANIZATION } from "./fields";
import type { UpdateUserPayload } from "./types";
import { defaultFields } from "../asset-index-settings/helpers";
import { defaultUserCategories } from "../category/default-categories";
import { getOrganizationsBySsoDomain } from "../organization/service.server";
import { createTeamMember } from "../team-member/service.server";

const label: ErrorLabel = "User";

type UserWithInclude<T extends Prisma.UserInclude | undefined> =
  T extends Prisma.UserInclude ? Prisma.UserGetPayload<{ include: T }> : User;

export async function getUserByID<T extends Prisma.UserInclude | undefined>(
  id: User["id"],
  include?: T
): Promise<UserWithInclude<T>> {
  try {
    const user = await db.user.findUniqueOrThrow({
      where: { id },
      include: { ...include },
    });

    return user as UserWithInclude<T>;
  } catch (cause) {
    throw new ShelfError({
      cause,
      title: "User not found",
      message: "The user you are trying to access does not exist.",
      additionalData: { id, include },
      label,
    });
  }
}

export async function findUserByEmail(email: User["email"]) {
  try {
    return await db.user.findUnique({ where: { email: email.toLowerCase() } });
  } catch (cause) {
    throw new ShelfError({
      cause,
      message: "Failed to find user",
      additionalData: { email },
      label,
    });
  }
}

async function createUserOrgAssociation(
  tx: Omit<ExtendedPrismaClient, ITXClientDenyList>,
  payload: {
    roles: OrganizationRoles[];
    organizationIds: Organization["id"][];
    userId: User["id"];
  }
) {
  const { organizationIds, userId, roles } = payload;

  try {
    return await Promise.all(
      Array.from(new Set(organizationIds)).map((organizationId) =>
        tx.userOrganization.upsert({
          where: {
            userId_organizationId: {
              userId,
              organizationId,
            },
          },
          create: {
            userId,
            organizationId,
            roles,
          },
          update: {
            roles: {
              push: roles,
            },
          },
        })
      )
    );
  } catch (cause) {
    throw new ShelfError({
      cause,
      message: "Failed to create user organization association",
      additionalData: { payload },
      label,
    });
  }
}

export async function createUserOrAttachOrg({
  email,
  organizationId,
  roles,
  password,
  firstName,
  createdWithInvite = false,
}: Pick<User, "email" | "firstName"> & {
  organizationId: Organization["id"];
  roles: OrganizationRoles[];
  password: string;
  /** We mark  */
  createdWithInvite: boolean;
}) {
  try {
    const shelfUser = await db.user.findFirst({ where: { email } });

    /**
     * If user does not exist, create a new user and attach the org to it
     * WE have a case where a user registers which only creates an auth account and before confirming their email they try to accept an invite
     * This will always fail because we need them to confirm their email before we create a user in shelf
     */
    if (!shelfUser?.id) {
      const authAccount = await createEmailAuthAccount(email, password).catch(
        (cause) => {
          throw new ShelfError({
            cause,
            message:
              "We are facing some issue with your account. Most likely you are trying to accept an invite, before you have confirmed your account's email. Please try again after confirming your email. If the issue persists, feel free to contact support.",
            label,
          });
        }
      );

      return await createUser({
        email,
        userId: authAccount.id,
        username: randomUsernameFromEmail(email),
        organizationId,
        roles,
        firstName,
        createdWithInvite,
      });
    }

    /** If the user already exists, we just attach the new org to it */
    await createUserOrgAssociation(db, {
      userId: shelfUser.id,
      organizationIds: [organizationId],
      roles,
    });

    return shelfUser;
  } catch (cause) {
    throw new ShelfError({
      cause,
      message: isLikeShelfError(cause)
        ? cause.message
        : `There was an issue with creating/attaching user with email: ${email}`,
      additionalData: { email, organizationId, roles, firstName },
      label,
    });
  }
}

/**
 * Creates a new user from SSO authentication or handles subsequent logins.
 *
 * This function handles two SSO scenarios:
 * 1. Pure SSO: User authenticates via SSO but their workspace access is managed manually through invites
 * 2. SCIM SSO: User authenticates via SSO and their workspace access is managed through IDP group mappings
 *
 * All SSO users get a personal workspace and can be invited to other workspaces manually,
 * even if no organizations are configured to use their email domain.
 *
 * @param authSession - The authentication session from Supabase containing user ID and email
 * @param userData - User data received from the SSO provider
 * @param userData.firstName - User's first name from SSO provider
 * @param userData.lastName - User's last name from SSO provider
 * @param userData.groups - Array of group IDs the user belongs to in the IDP
 *
 * @returns Object containing the created/updated user and their first organization (if any)
 * @throws ShelfError if user creation/update fails
 */

export async function createUserFromSSO(
  authSession: AuthSession,
  userData: {
    firstName: string;
    lastName: string;
    groups: string[];
  }
) {
  try {
    const { email, userId } = authSession;

    const { firstName, lastName, groups } = userData;
    const domain = email.split("@")[1];

    // Create user with personal workspace - all users get this now
    const user = await createUser({
      email,
      firstName,
      lastName,
      userId,
      username: randomUsernameFromEmail(email),
      isSSO: true,
    });

    // Find organizations that use this email domain for SSO
    const organizations = await getOrganizationsBySsoDomain(domain);

    // No organizations using this domain is perfectly valid for Pure SSO
    // User can still log in and will be able to access workspaces through invites
    if (organizations.length > 0) {
      // Process SCIM access for organizations that have group mappings
      for (const org of organizations) {
        const { ssoDetails } = org;
        if (!ssoDetails) continue;

        // Check if this organization uses SCIM (has group mappings)
        const hasGroupMappings = !!(
          ssoDetails.adminGroupId ||
          ssoDetails.baseUserGroupId ||
          ssoDetails.selfServiceGroupId
        );

        if (hasGroupMappings) {
          const role = getRoleFromGroupId(ssoDetails, groups);
          if (role) {
            await createUserOrgAssociation(db, {
              userId: user.id,
              organizationIds: [org.id],
              roles: [role],
            });

            await createTeamMember({
              name: `${firstName} ${lastName}`,
              organizationId: org.id,
              userId,
            });
          }
        }
      }
    }

    // Return the user and org (if any SCIM orgs exist)
    // For pure SSO with no org mappings, org will be null
    return { user, org: organizations[0] || null };
  } catch (cause: any) {
    throw new ShelfError({
      cause,
      message: `Failed to create SSO user: ${cause.message}`,
      additionalData: {
        email: authSession.email,
        userId: authSession.userId,
        domain: authSession.email.split("@")[1],
      },
      label: "Auth",
    });
  }
}

interface UserOrgTransition {
  userId: string;
  organizationId: string;
  previousRoles: OrganizationRoles[];
  newRole: OrganizationRoles | null;
  transitionType: "ROLE_CHANGE" | "ACCESS_REVOKED" | "ACCESS_GRANTED";
}

/**
 * Handles the transition of user access when org switches from invite-based to SCIM-based
 * @returns Object containing transition details for logging/notification
 */
async function handleSCIMTransition(
  userId: string,
  organization: Organization,
  currentRoles: OrganizationRoles[],
  desiredRole: OrganizationRoles | null
): Promise<UserOrgTransition> {
  const transition: UserOrgTransition = {
    userId,
    organizationId: organization.id,
    previousRoles: currentRoles,
    newRole: desiredRole,
    transitionType:
      currentRoles[0] !== desiredRole ? "ROLE_CHANGE" : "ACCESS_REVOKED",
  };

  try {
    if (!desiredRole) {
      // User has no valid SCIM groups, revoke access
      await db.userOrganization.delete({
        where: {
          userId_organizationId: {
            userId,
            organizationId: organization.id,
          },
        },
      });

      transition.transitionType = "ACCESS_REVOKED";

      Logger.info({
        message: "Revoked user access due to SCIM group changes",
        additionalData: {
          userId,
          organizationId: organization.id,
          previousRoles: currentRoles,
        },
      });
    } else {
      // Update to SCIM-based role
      await db.userOrganization.update({
        where: {
          userId_organizationId: {
            userId,
            organizationId: organization.id,
          },
        },
        data: {
          roles: {
            set: [desiredRole],
          },
        },
      });

      transition.transitionType = "ROLE_CHANGE";

      Logger.info({
        message: "Updated user role based on SCIM groups",
        additionalData: {
          userId,
          organizationId: organization.id,
          previousRoles: currentRoles,
          newRole: desiredRole,
        },
      });
    }

    return transition;
  } catch (cause) {
    throw new ShelfError({
      cause,
      message: "Failed to handle SCIM transition",
      additionalData: {
        userId,
        organizationId: organization.id,
        currentRoles,
        desiredRole,
      },
      label: "SSO",
    });
  }
}

/**
 * Updates an existing SSO user on subsequent logins.
 * Handles both Pure SSO and SCIM SSO scenarios:
 *
 * For Pure SSO users:
 * - Updates their name if changed in IDP
 * - Maintains their personal workspace and manual workspace invites
 *
 * For SCIM SSO users:
 * - Updates their name if changed in IDP
 * - Updates their workspace access based on current IDP group membership
 * - Maintains their personal workspace regardless of group membership
 *
 * @param authSession - The authentication session from Supabase
 * @param existingUser - The existing user record from our database
 * @param userData - Updated user data from SSO provider
 * @returns Object containing updated user and org (if any SCIM orgs exist)
 */
export async function updateUserFromSSO(
  authSession: AuthSession,
  existingUser: Prisma.UserGetPayload<{
    include: typeof INCLUDE_SSO_DETAILS_VIA_USER_ORGANIZATION;
  }>,
  userData: {
    firstName: string;
    lastName: string;
    groups: string[];
  }
): Promise<{
  user: User;
  org: Organization | null;
  transitions: UserOrgTransition[];
}> {
  const { email, userId } = authSession;
  const { firstName, lastName, groups } = userData;
  const domain = email.split("@")[1];
  const transitions: UserOrgTransition[] = [];

  try {
    let user = existingUser;

    // Update user profile if needed
    if (user.firstName !== firstName || user.lastName !== lastName) {
      user = await db.user.update({
        where: { id: userId },
        data: { firstName, lastName },
        include: INCLUDE_SSO_DETAILS_VIA_USER_ORGANIZATION,
      });
    }

    const domainOrganizations = await getOrganizationsBySsoDomain(domain);
    const existingUserOrganizations = user.userOrganizations;

    for (const org of domainOrganizations) {
      const { ssoDetails } = org;
      if (!ssoDetails) continue;

      const hasGroupMappings = !!(
        ssoDetails.adminGroupId ||
        ssoDetails.baseUserGroupId ||
        ssoDetails.selfServiceGroupId
      );

      if (hasGroupMappings) {
        const desiredRole = getRoleFromGroupId(ssoDetails, groups);
        const existingOrgAccess = existingUserOrganizations.find(
          (uo) => uo.organization.id === org.id
        );

        if (existingOrgAccess) {
          // Handle transition for existing access
          const transition = await handleSCIMTransition(
            userId,
            org,
            existingOrgAccess.roles,
            desiredRole
          );
          transitions.push(transition);
        }
      }
    }

    // Return first org with SCIM access for redirect
    const firstScimOrg = domainOrganizations.find(
      (org) =>
        org.ssoDetails &&
        (org.ssoDetails.adminGroupId ||
          org.ssoDetails.baseUserGroupId ||
          org.ssoDetails.selfServiceGroupId)
    );

    return {
      user,
      org: firstScimOrg || null,
      transitions,
    };
  } catch (cause) {
    throw new ShelfError({
      cause,
      message: `Failed to update SSO user: ${email}`,
      additionalData: {
        email,
        userId,
        domain,
        transitions,
      },
      label: "SSO",
    });
  }
}

export async function createUser(
  payload: Pick<
    AuthSession & { username: string },
    "userId" | "email" | "username"
  > & {
    organizationId?: Organization["id"];
    roles?: OrganizationRoles[];
    firstName?: User["firstName"];
    lastName?: User["lastName"];
    isSSO?: boolean;
    createdWithInvite?: boolean;
  }
) {
  const {
    email,
    userId,
    username,
    organizationId,
    roles,
    firstName,
    lastName,
    isSSO,
    createdWithInvite,
  } = payload;

  /**
   * We only create a personal org if the signup is not disabled
   * */
  const shouldCreatePersonalOrg = !config.disableSignup;

  try {
    return await db.$transaction(
      async (tx) => {
        const user = await tx.user.create({
          data: {
            email,
            id: userId,
            username,
            firstName,
            lastName,
            createdWithInvite,
            roles: {
              connect: {
                name: Roles["USER"],
              },
            },

            ...(shouldCreatePersonalOrg && {
              organizations: {
                create: [
                  {
                    name: "Personal",
                    categories: {
                      create: defaultUserCategories.map((c) => ({
                        ...c,
                        userId,
                      })),
                    },
                    /**
                     * Creating a teamMember when a new organization/workspace is created
                     * so that the owner appear in the list by default
                     */
                    members: {
                      create: {
                        name: `${firstName} ${lastName} (Owner)`,
                        user: { connect: { id: userId } },
                      },
                    },
                    // Creating asset index settings for new users' personal org
                    assetIndexSettings: {
                      create: {
                        mode: "SIMPLE",
                        columns: defaultFields,
                        user: {
                          connect: {
                            id: userId,
                          },
                        },
                      },
                    },
                  },
                ],
              },
            }),
            ...(isSSO && {
              // When user is coming from SSO, we set them as onboarded as we already have their first and last name and they dont need a password.
              onboarded: true,
              sso: true,
            }),
          },
          include: {
            ...INCLUDE_SSO_DETAILS_VIA_USER_ORGANIZATION,
            organizations: true,
          },
        });

        /**
         * Creating an organization for the user
         * 1. For the personal org
         * 2. For the org that the user is being attached to
         */
        await Promise.all([
          shouldCreatePersonalOrg && // We only create a personal org for non-SSO users
            createUserOrgAssociation(tx, {
              userId: user.id,
              organizationIds: [user.organizations[0].id],
              roles: [OrganizationRoles.OWNER],
            }),
          organizationId &&
            roles?.length &&
            createUserOrgAssociation(tx, {
              userId: user.id,
              organizationIds: [organizationId],
              roles,
            }),
        ]);

        return user;
      },
      { maxWait: 6000, timeout: 10000 }
    );
  } catch (cause) {
    throw new ShelfError({
      cause,
      message: "We had trouble while creating your account. Please try again.",
      additionalData: {
        payload,
      },
      label,
    });
  }
}

export async function updateUser<T extends Prisma.UserInclude>(
  updateUserPayload: UpdateUserPayload,
  extraIncludes?: T
) {
  /**
   * Remove password from object so we can pass it to prisma user update
   * Also we remove the email as we dont allow it to be changed for now
   * */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const cleanClone = (({ password, confirmPassword, email, ...o }) => o)(
    updateUserPayload
  );

  try {
    const updatedUser = await db.user.update({
      where: { id: updateUserPayload.id },
      data: {
        ...cleanClone,
        teamMembers: {
          updateMany: {
            where: { userId: updateUserPayload.id },
            data: {
              name: `${
                updateUserPayload.firstName ? updateUserPayload.firstName : ""
              } ${
                updateUserPayload.lastName ? updateUserPayload.lastName : ""
              }`,
            },
          },
        },
      },
      include: {
        ...extraIncludes,
      },
    });

    if (
      updateUserPayload.password &&
      updateUserPayload.password.trim() !== ""
    ) {
      await updateAccountPassword(
        updateUserPayload.id,
        updateUserPayload.password
      );
    }

    return updatedUser as Prisma.UserGetPayload<{ include: T }>;
  } catch (cause) {
    const validationErrors: ValidationError<any> = {};

    const isUniqueViolation =
      cause instanceof Prisma.PrismaClientKnownRequestError &&
      cause.code === "P2002";

    if (isUniqueViolation) {
      // The .code property can be accessed in a type-safe manner
      validationErrors[cause.meta?.target as string] = {
        message: `${cause.meta?.target} is already taken.`,
      };
    }

    throw new ShelfError({
      cause,
      message:
        "Something went wrong while updating your profile. Please try again or contact support.",
      additionalData: { ...cleanClone, validationErrors },
      label,
      shouldBeCaptured: !isUniqueViolation,
    });
  }
}

/**
 * Updates user email in both the auth and shelf databases
 * If for some reason the user update fails we should also revenrt the auth account update
 */
export async function updateUserEmail({
  userId,
  currentEmail,
  newEmail,
}: {
  userId: User["id"];
  currentEmail: User["email"];
  newEmail: string;
}) {
  try {
    /**
     * Update the user in supabase auth
     */
    const { error } = await getSupabaseAdmin().auth.admin.updateUserById(
      userId,
      {
        email: newEmail,
      }
    );

    if (error) {
      throw new ShelfError({
        cause: error,
        message:
          "Failed to update email in auth. Please try again and if the issue persists, contact support",
        additionalData: { userId, newEmail, currentEmail },
        label,
      });
    }

    /** Update the user in the DB */
    const updatedUser = await db.user
      .update({
        where: { id: userId },
        data: { email: newEmail },
      })
      .catch((cause) => {
        // On failure, revert the change of the user update in auth
        void getSupabaseAdmin().auth.admin.updateUserById(userId, {
          email: currentEmail,
        });

        // Unique email constraint is being handled automatically by `getSupabaseAdmin().auth.admin.generateLink`
        throw new ShelfError({
          cause,
          message: "Failed to update email in shelf",
          additionalData: { userId, newEmail, currentEmail },
          label,
        });
      });

    return updatedUser;
  } catch (cause) {
    throw new ShelfError({
      cause,
      message: "Failed to update email",
      additionalData: { userId, currentEmail, newEmail },
      label,
    });
  }
}

export const getPaginatedAndFilterableUsers = async ({
  request,
}: {
  request: LoaderFunctionArgs["request"];
}) => {
  const searchParams = getCurrentSearchParams(request);
  const { page, search } = getParamsValues(searchParams);

  try {
    const { users, totalUsers } = await getUsers({
      page,
      perPage: 25,
      search,
    });
    const totalPages = Math.ceil(totalUsers / 25);

    return {
      page,
      perPage: 25,
      search,
      totalUsers,
      users,
      totalPages,
    };
  } catch (cause) {
    throw new ShelfError({
      cause,
      message: "Failed to get paginated and filterable users",
      additionalData: { page, search },
      label,
    });
  }
};

async function getUsers({
  page = 1,
  perPage = 8,
  search,
}: {
  /** Page number. Starts at 1 */
  page: number;

  /** Assets to be loaded per page */
  perPage?: number;

  search?: string | null;
}) {
  try {
    const skip = page > 1 ? (page - 1) * perPage : 0;
    const take = perPage >= 1 && perPage <= 25 ? perPage : 8; // min 1 and max 25 per page

    /** Default value of where. Takes the assets belonging to current user */
    let where: Prisma.UserWhereInput = {};

    /** If the search string exists, add it to the where object */
    if (search) {
      where.OR = [
        {
          email: {
            contains: search,
            mode: "insensitive",
          },
        },
        {
          id: {
            contains: search,
            mode: "insensitive",
          },
        },
      ];
    }

    const [users, totalUsers] = await Promise.all([
      /** Get the users */
      db.user.findMany({
        skip,
        take,
        where,
        orderBy: { createdAt: "desc" },
      }),

      /** Count them */
      db.user.count({ where }),
    ]);

    return { users, totalUsers };
  } catch (cause) {
    throw new ShelfError({
      cause,
      message: "Failed to get users",
      additionalData: { page, perPage, search },
      label,
    });
  }
}

export async function updateProfilePicture({
  request,
  userId,
}: {
  request: Request;
  userId: User["id"];
}) {
  try {
    const user = await getUserByID(userId);
    const previousProfilePictureUrl = user.profilePicture || undefined;

    const fileData = await parseFileFormData({
      request,
      newFileName: `${userId}/profile-${dateTimeInUnix(Date.now())}`,
      resizeOptions: {
        height: 150,
        width: 150,
        fit: sharp.fit.cover,
        withoutEnlargement: true,
      },
    });

    const profilePicture = fileData.get("profile-picture") as string;

    /**
     * Delete the old image, if a new one was uploaded
     */
    if (profilePicture && previousProfilePictureUrl) {
      await deleteProfilePicture({ url: previousProfilePictureUrl });
    }

    /** Update user with new picture */
    return await updateUser({
      id: userId,
      profilePicture: profilePicture
        ? getPublicFileURL({ filename: profilePicture })
        : undefined,
    });
  } catch (cause) {
    throw new ShelfError({
      cause,
      message:
        "Something went wrong while updating your profile picture. Please try again or contact support.",
      additionalData: { userId },
      label,
    });
  }
}

/**
 * To prevent database issues and data loss, we do soft delete.
 * To comply with regulations, we will destroy all personal data related to the user
 *
 * To soft delete the user we do the following:
 * 1. Update the user email to: deleted+{randomId}@deleted.shelf.nu
 * 2. Update the user username to: deleted+{randomId}
 * 3. Update the user firstName to: Deleted
 * 4. Update the user lastName to: User
 * 5. Delete the user's profile picture
 * 6. Remove all relations to organizations the user is part of but doesnt own
 * 7. Move all entities the user created inside organizations the user is part of but doesnt own to the owner of the organization
 */
export async function softDeleteUser(id: User["id"]) {
  try {
    const user = await getUserByID(id, {
      userOrganizations: {
        include: {
          organization: {
            select: { id: true, userId: true },
          },
        },
      },
    });

    const organizationsTheUserDoesNotOwn = user.userOrganizations.filter(
      (uo) => !uo.roles.includes(OrganizationRoles.OWNER)
    );

    await db.$transaction(async (tx) => {
      /** Move entries inside each of organizationsTheUserDoesNotOwn from following models:
       *   - [x] Asset
       *   - [x] Category
       *   - [x] Tag
       *   - [x] Location
       *   - [x] CustomField
       *   - [x] Invite
       *   - [x] Booking
       *   - [x] Image
       *   - [x] Kit
       * The new owner should be the owner of the organization
       */
      for (const userOrg of organizationsTheUserDoesNotOwn) {
        const newOwnerId = userOrg.organization?.userId;

        if (newOwnerId) {
          await transferEntitiesToNewOwner({
            tx,
            id,
            newOwnerId,
            organizationId: userOrg.organizationId,
          });
        }
        /**
         * Remove the user from all organizations the user belongs to but doesnt own.
         * */
        await revokeAccessToOrganization({
          userId: id,
          organizationId: userOrg.organizationId,
        });
      }

      /** Update the user data */

      const randomId = generateId();
      await tx.user.update({
        where: { id },
        data: {
          email: `deleted+${randomId}@deleted.shelf.nu`,
          username: `deleted+${randomId}`,
          firstName: "Deleted",
          lastName: "User",
          deletedAt: new Date(),
        },
      });
    });

    /**
     * Delete the picture of the user
     *
     * Note: This happens outside of the transaction because we dont want to rollback the deletion of the user if the deletion of the picture fails
     * If it fails for some reason, we will get it in our logs that there was an issue so we can check it manually
     * */
    if (user.profilePicture) {
      await deleteProfilePicture({ url: user.profilePicture });
    }

    /** Send an email to the user that their request has been completed */
    void sendEmail({
      to: user.email,
      subject: "Your account has been deleted",
      text: `Your shelf account has been deleted. \n\n Kind regards, \n Shelf Team\n\n`,
    });
  } catch (cause) {
    if (
      cause instanceof PrismaClientKnownRequestError &&
      cause.code === "P2025"
    ) {
      // eslint-disable-next-line no-console
      console.log("User not found, so no need to delete");
    } else {
      throw new ShelfError({
        cause,
        message: "Unable to delete user",
        additionalData: { id },
        label,
      });
    }
  }
}

export { defaultUserCategories };

/** THis function is used just for integration tests as it combines the creation of auth account and user entry */
export async function createUserAccountForTesting(
  email: string,
  password: string,
  username: string
): Promise<AuthSession | null> {
  const authAccount = await createEmailAuthAccount(email, password).catch(
    () => null
  );

  if (!authAccount) {
    return null;
  }

  const authSession = await signInWithEmail(email, password).catch(() => null);

  // user account created but no session 😱
  // we should delete the user account to allow retry create account again
  if (!authSession) {
    await deleteAuthAccount(authAccount.id);
    return null;
  }

  const user = await createUser({
    email: authSession.email,
    userId: authSession.userId,
    username,
  }).catch(() => null);

  if (!user) {
    await deleteAuthAccount(authAccount.id);
    return null;
  }

  return authSession;
}

export async function revokeAccessToOrganization({
  userId,
  organizationId,
}: {
  userId: User["id"];
  organizationId: Organization["id"];
}) {
  try {
    /**
     * if I want to revokeAccess access, i simply need to:
     * 1. Remove relation between user and team member
     * 2. remove the UserOrganization entry which has the org.id and user.id that i am revoking
     */
    const teamMember = await db.teamMember.findFirst({
      where: { userId, organizationId },
    });

    return await db.user.update({
      where: { id: userId },
      data: {
        ...(teamMember?.id && {
          teamMembers: {
            disconnect: {
              id: teamMember.id,
            },
          },
        }),
        userOrganizations: {
          delete: {
            userId_organizationId: {
              userId,
              organizationId,
            },
          },
        },
      },
    });
  } catch (cause) {
    throw new ShelfError({
      cause,
      message: "Failed to revoke user access to organization",
      additionalData: { userId, organizationId },
      label,
    });
  }
}

/** Move entries inside an organization from 1 owner to another.
 * Affects the following models:
 *   - [x] Asset
 *   - [x] Category
 *   - [x] Tag
 *   - [x] Location
 *   - [x] CustomField
 *   - [x] Invite
 *   - [x] Booking
 *   - [x] Image
 *   - [x] Kit
 * Required to be used inside a transaction
 */
export async function transferEntitiesToNewOwner({
  tx,
  id,
  newOwnerId,
  organizationId,
}: {
  tx: Omit<ExtendedPrismaClient, ITXClientDenyList>;
  id: User["id"];
  newOwnerId: User["id"];
  organizationId: Organization["id"];
}) {
  /** Update assets */
  await tx.asset.updateMany({
    where: {
      userId: id,
      organizationId: organizationId,
    },
    data: {
      userId: newOwnerId,
    },
  });

  /** Update categories */
  await tx.category.updateMany({
    where: {
      userId: id,
      organizationId: organizationId,
    },
    data: {
      userId: newOwnerId,
    },
  });

  /** Update tags */
  await tx.tag.updateMany({
    where: {
      userId: id,
      organizationId: organizationId,
    },
    data: {
      userId: newOwnerId,
    },
  });

  /** Update locations */
  await tx.location.updateMany({
    where: {
      userId: id,
      organizationId: organizationId,
    },
    data: {
      userId: newOwnerId,
    },
  });

  /** Update custom fields */
  await tx.customField.updateMany({
    where: {
      userId: id,
      organizationId: organizationId,
    },
    data: {
      userId: newOwnerId,
    },
  });

  /** Update invites */
  await tx.invite.updateMany({
    where: {
      inviterId: id,
      organizationId: organizationId,
    },
    data: {
      inviterId: newOwnerId,
    },
  });

  /** Update bookings */
  await tx.booking.updateMany({
    where: {
      creatorId: id,
      organizationId: organizationId,
    },
    data: {
      creatorId: newOwnerId,
    },
  });

  /** Update bookings where the person deleted is the custodian */
  await tx.booking.updateMany({
    where: {
      custodianUserId: id,
      organizationId: organizationId,
    },
    data: {
      custodianUserId: null,
    },
  });

  /** Update images */
  await tx.image.updateMany({
    where: {
      userId: id,
      ownerOrgId: organizationId,
    },
    data: {
      userId: newOwnerId,
    },
  });

  /** Update kits */
  await tx.kit.updateMany({
    where: {
      createdById: id,
      organizationId: organizationId,
    },
    data: {
      createdById: newOwnerId,
    },
  });
}
