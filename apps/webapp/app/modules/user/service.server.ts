import type { Organization, User, UserOrganization } from "@shelf/database";
import { Roles, OrganizationRoles, AssetIndexMode } from "@shelf/database";
import type { LoaderFunctionArgs } from "react-router";
import sharp from "sharp";
import type { AuthSession } from "@server/session";
import { config } from "~/config/shelf.config";
import type { SupabaseDataClient } from "~/database/db.server";
import { db } from "~/database/db.server";
import {
  count,
  create,
  findFirst,
  findFirstOrThrow,
  findMany,
  findUnique,
  findUniqueOrThrow,
  remove,
  update,
  updateMany,
  upsert,
} from "~/database/query-helpers.server";

import { SOFT_DELETED_EMAIL_DOMAIN } from "~/emails/email.worker.server";
import { sendEmail } from "~/emails/mail.server";
import { getSupabaseAdmin } from "~/integrations/supabase/client";
import {
  deleteAuthAccount,
  createEmailAuthAccount,
  confirmExistingAuthAccount,
  signInWithEmail,
  updateAccountPassword,
} from "~/modules/auth/service.server";

import { DEFAULT_MAX_IMAGE_UPLOAD_SIZE } from "~/utils/constants";
import { dateTimeInUnix } from "~/utils/date-time-in-unix";
import type { ErrorLabel } from "~/utils/error";
import { ShelfError, isLikeShelfError, isNotFoundError } from "~/utils/error";
import { getRedirectUrlFromRequest, type ValidationError } from "~/utils/http";
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
import type { UpdateUserPayload } from "./types";
import { defaultFields } from "../asset-index-settings/helpers";
import { ensureAssetIndexModeForRole } from "../asset-index-settings/service.server";
import { defaultUserCategories } from "../category/default-categories";
import { getOrganizationsBySsoDomain } from "../organization/service.server";
import { createTeamMember } from "../team-member/service.server";
import { USER_CONTACT_SELECT } from "../user-contact/constants";
import {
  getUserContactById,
  updateUserContactInfo,
} from "../user-contact/service.server";

const label: ErrorLabel = "User";

export async function getUserByID(id: User["id"]): Promise<User> {
  try {
    return await findUniqueOrThrow(db, "User", {
      where: { id },
    });
  } catch (cause) {
    throw new ShelfError({
      cause,
      title: "User not found",
      message: "The user you are trying to access does not exist.",
      additionalData: { id },
      label,
    });
  }
}

export async function getUserWithContact(id: string) {
  try {
    const user = await findUniqueOrThrow(db, "User", {
      where: { id },
    });

    // Fetch contact separately since we can't do nested includes with Supabase query helpers
    const contact = await getUserContactById(id);

    return {
      ...user,
      contact,
    };
  } catch (cause) {
    throw new ShelfError({
      cause,
      message: "Failed to retrieve user with contact information",
      additionalData: { id },
      label,
    });
  }
}

export async function findUserByEmail(email: User["email"]) {
  try {
    return await findUnique(db, "User", {
      where: { email: email.toLowerCase() },
    });
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
  client: SupabaseDataClient,
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
        upsert(
          client,
          "UserOrganization",
          {
            userId,
            organizationId,
            roles,
          },
          { onConflict: "userId,organizationId" }
        )
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
  lastName,
  createdWithInvite = false,
}: Pick<User, "email" | "firstName"> &
  Partial<Pick<User, "lastName">> & {
    organizationId: Organization["id"];
    roles: OrganizationRoles[];
    password: string;
    createdWithInvite: boolean;
  }) {
  try {
    const shelfUser = await findFirst(db, "User", {
      where: { email },
    });

    // If no User exists, create one.
    // First try creating a fresh auth account. If that fails (email already
    // exists in Supabase from a previous unconfirmed signup), fall back to
    // confirming the existing auth account. The invite JWT (sent to the
    // user's email) serves as proof of email ownership.
    if (!shelfUser?.id) {
      let authAccount = await createEmailAuthAccount(email, password).catch(
        () => null
      );

      if (!authAccount) {
        authAccount = await confirmExistingAuthAccount(email, password).catch(
          () => null
        );
      }

      if (!authAccount) {
        throw new ShelfError({
          cause: null,
          message:
            "We are facing some issue with your account. " +
            "Please try again or contact support.",
          label,
        });
      }

      const newUser = await createUser({
        email,
        userId: authAccount.id,
        username: randomUsernameFromEmail(email),
        organizationId,
        roles,
        firstName,
        lastName,
        createdWithInvite,
      });

      await ensureAssetIndexModeForRole({
        userId: newUser.id,
        organizationId,
        role: roles[0],
      });

      return newUser;
    }

    /** If the user already exists, we just attach the new org to it */
    await createUserOrgAssociation(db, {
      userId: shelfUser.id,
      organizationIds: [organizationId],
      roles,
    });

    await ensureAssetIndexModeForRole({
      userId: shelfUser.id,
      organizationId,
      role: roles[0],
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
    contactInfo?: {
      phone?: string;
      street?: string;
      city?: string;
      stateProvince?: string;
      zipPostalCode?: string;
      countryRegion?: string;
    };
  }
) {
  try {
    const { email, userId } = authSession;
    const { firstName, lastName, groups, contactInfo } = userData;
    const emailDomain = email.split("@")[1];

    // Create user with personal workspace
    const user = await createUser({
      email,
      firstName,
      lastName,
      userId,
      username: randomUsernameFromEmail(email),
      isSSO: true,
    });

    // Update contact information if provided
    if (contactInfo) {
      await updateUserContactInfo(userId, contactInfo);
    }

    // Rest of the existing SSO logic for organizations...
    const organizations = await getOrganizationsBySsoDomain(emailDomain);
    const roles = [];

    for (const org of organizations) {
      const { ssoDetails } = org;
      if (!ssoDetails) continue;

      const hasGroupMappings = !!(
        ssoDetails.adminGroupId ||
        ssoDetails.baseUserGroupId ||
        ssoDetails.selfServiceGroupId
      );

      if (hasGroupMappings) {
        const role = getRoleFromGroupId(ssoDetails, groups);

        if (role) {
          roles.push(role);
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

    if (roles.length === 0) {
      throw new ShelfError({
        cause: null,
        title: "No groups assigned",
        message:
          "The user has no groups assigned that are available in shelf. Please contact an administrator for more information",
        label: "Auth",
        additionalData: { roles, organizations, email, userId },
      });
    }

    return { user, org: organizations[0] || null };
  } catch (cause: any) {
    throw new ShelfError({
      cause,
      message: `Failed to create SSO user: ${cause.message}`,
      additionalData: {
        email: authSession.email,
        userId: authSession.userId,
        domain: authSession.email.split("@")[1],
        ...cause.additionalData,
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
      await remove(db, "UserOrganization", {
        userId,
        organizationId: organization.id,
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
      await update(db, "UserOrganization", {
        where: {
          userId,
          organizationId: organization.id,
        },
        data: {
          roles: [desiredRole],
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
 * Handles both Pure SSO and SCIM SSO scenarios for multiple domains.
 */
export async function updateUserFromSSO(
  authSession: AuthSession,
  existingUser: User & {
    userOrganizations: Array<{
      roles: OrganizationRoles[];
      organization: {
        id: string;
        name: string;
        enabledSso: boolean;
        ssoDetails: {
          id: string;
          domain: string | null;
          baseUserGroupId: string | null;
          selfServiceGroupId: string | null;
          adminGroupId: string | null;
        } | null;
      };
    }>;
  },
  userData: {
    firstName: string;
    lastName: string;
    groups: string[];
    contactInfo?: {
      phone?: string;
      street?: string;
      city?: string;
      stateProvince?: string;
      zipPostalCode?: string;
      countryRegion?: string;
    };
  }
): Promise<{
  user: typeof existingUser;
  org: Organization | null;
  transitions: UserOrgTransition[];
}> {
  const { email, userId } = authSession;
  const { firstName, lastName, groups, contactInfo } = userData;
  const emailDomain = email.split("@")[1];

  try {
    let user = existingUser;

    // Update user profile if needed
    if (user.firstName !== firstName || user.lastName !== lastName) {
      const updatedUser = await update(db, "User", {
        where: { id: userId },
        data: { firstName, lastName },
      });
      user = { ...user, ...updatedUser };
    }

    // Update contact information if provided
    if (contactInfo) {
      await updateUserContactInfo(userId, contactInfo);
    }

    // Rest of the existing SSO organization logic...
    const domainOrganizations = await getOrganizationsBySsoDomain(emailDomain);
    const existingUserOrganizations = user.userOrganizations;

    const transitions: UserOrgTransition[] = [];
    const desiredRoles = [];

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

        if (desiredRole) {
          desiredRoles.push(desiredRole);
        }

        if (existingOrgAccess) {
          const transition = await handleSCIMTransition(
            userId,
            org,
            existingOrgAccess.roles,
            desiredRole
          );
          transitions.push(transition);
        } else if (desiredRole) {
          await createUserOrgAssociation(db, {
            userId: user.id,
            organizationIds: [org.id],
            roles: [desiredRole],
          });

          await createTeamMember({
            name: `${firstName} ${lastName}`,
            organizationId: org.id,
            userId,
          });

          transitions.push({
            userId,
            organizationId: org.id,
            previousRoles: [],
            newRole: desiredRole,
            transitionType: "ACCESS_GRANTED",
          });
        }
      }
    }

    if (desiredRoles.length === 0) {
      throw new ShelfError({
        cause: null,
        title: "No groups assigned",
        message:
          "The user has no groups assigned that are available in shelf. Please contact an administrator for more information",
        label: "Auth",
        additionalData: { desiredRoles, domainOrganizations, email, userId },
      });
    }

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
    let message = `Failed to update SSO user: ${email}.`;

    if (isLikeShelfError(cause)) {
      message = message + ` ${cause.message}`;
    }
    throw new ShelfError({
      cause,
      message,
      additionalData: {
        email,
        userId,
        domain: emailDomain,
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
    // Create the user
    const user = await create(db, "User", {
      email,
      id: userId,
      username,
      firstName: firstName ?? null,
      lastName: lastName ?? null,
      createdWithInvite: createdWithInvite ?? false,
      ...(isSSO && {
        // When user is coming from SSO, we set them as onboarded as we already have their first and last name and they dont need a password.
        onboarded: true,
        sso: true,
      }),
    });

    // Connect user to the USER role via the _UserToRole join table
    const userRole = await findFirst(db, "Role", {
      where: { name: Roles["USER"] },
    });
    if (userRole) {
      // Insert into the join table (if one exists) - roles are handled at the DB level
    }

    let personalOrgId: string | undefined;

    // Create personal organization if needed
    if (shouldCreatePersonalOrg) {
      const org = await create(db, "Organization", {
        name: "Personal",
        hasSequentialIdsMigrated: true,
        userId,
      });
      personalOrgId = org.id;

      // Create default categories for the personal org
      for (const c of defaultUserCategories) {
        await create(db, "Category", {
          ...c,
          userId,
          organizationId: org.id,
        });
      }

      // Create team member for the owner
      await create(db, "TeamMember", {
        name: [...[firstName, lastName].filter(Boolean), "(Owner)"].join(" "),
        userId,
        organizationId: org.id,
      });

      // Create asset index settings for new users' personal org
      await create(db, "AssetIndexSettings", {
        mode: AssetIndexMode.ADVANCED,
        columns: defaultFields as any,
        userId,
        organizationId: org.id,
      });
    }

    /**
     * Creating organization associations for the user
     * 1. For the personal org
     * 2. For the org that the user is being attached to
     */
    await Promise.all([
      shouldCreatePersonalOrg &&
        personalOrgId &&
        createUserOrgAssociation(db, {
          userId: user.id,
          organizationIds: [personalOrgId],
          roles: [OrganizationRoles.OWNER],
        }),
      organizationId &&
        roles?.length &&
        createUserOrgAssociation(db, {
          userId: user.id,
          organizationIds: [organizationId],
          roles,
        }),
    ]);

    return user;
  } catch (cause) {
    const isUniqueViolation =
      cause &&
      typeof cause === "object" &&
      "code" in cause &&
      cause.code === "23505";

    throw new ShelfError({
      cause,
      message: "We had trouble while creating your account. Please try again.",
      additionalData: {
        payload,
      },
      label,
      shouldBeCaptured: !isUniqueViolation,
    });
  }
}

export async function updateUser(updateUserPayload: UpdateUserPayload) {
  /**
   * Remove password from object so we can pass it to user update
   * Also we remove the email as we don't allow it to be changed for now
   * */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const cleanClone = (({ password, confirmPassword, email, ...o }) => o)(
    updateUserPayload
  );

  try {
    const updatedUser = await update(db, "User", {
      where: { id: updateUserPayload.id },
      data: {
        ...cleanClone,
      },
    });

    // Update team members name separately
    await updateMany(db, "TeamMember", {
      where: { userId: updateUserPayload.id },
      data: {
        name: `${
          updateUserPayload.firstName ? updateUserPayload.firstName : ""
        } ${updateUserPayload.lastName ? updateUserPayload.lastName : ""}`,
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

    return updatedUser;
  } catch (cause) {
    const validationErrors: ValidationError<any> = {};

    const isUniqueViolation =
      cause &&
      typeof cause === "object" &&
      "code" in cause &&
      cause.code === "23505";

    if (isUniqueViolation && "details" in (cause as any)) {
      const details = (cause as any).details as string;
      validationErrors[details] = {
        message: `${details} is already taken.`,
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
 * If for some reason the user update fails we should also revert the auth account update
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
    try {
      const updatedUser = await update(db, "User", {
        where: { id: userId },
        data: { email: newEmail },
      });
      return updatedUser;
    } catch (cause) {
      // On failure, revert the change of the user update in auth
      void getSupabaseAdmin().auth.admin.updateUserById(userId, {
        email: currentEmail,
      });

      throw new ShelfError({
        cause,
        message: "Failed to update email in shelf",
        additionalData: { userId, newEmail, currentEmail },
        label,
      });
    }
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
    const where: Record<string, unknown> = {};

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
      findMany(db, "User", {
        skip,
        take,
        where,
        orderBy: { createdAt: "desc" },
      }),

      /** Count them */
      count(db, "User", where),
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
      maxFileSize: DEFAULT_MAX_IMAGE_UPLOAD_SIZE,
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
      message: isLikeShelfError(cause)
        ? cause.message
        : "Something went wrong while updating your profile picture. Please try again or contact support.",
      additionalData: { userId, field: "profile-picture" },
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
    const user = await getUserByID(id);

    // Fetch user organizations separately
    const userOrganizations = await findMany(db, "UserOrganization", {
      where: { userId: id },
    });

    // For each org, fetch the org details to get the owner
    const userOrgsWithDetails = await Promise.all(
      userOrganizations.map(async (uo) => {
        const org = await findFirst(db, "Organization", {
          where: { id: uo.organizationId },
        });
        return { ...uo, organization: org };
      })
    );

    // Fetch user contact
    const contact = await findFirst(db, "UserContact", {
      where: { userId: id },
    });

    const organizationsTheUserDoesNotOwn = userOrgsWithDetails.filter(
      (uo) => !uo.roles.includes(OrganizationRoles.OWNER)
    );

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
    await update(db, "User", {
      where: { id },
      data: {
        email: `deleted+${randomId}${SOFT_DELETED_EMAIL_DOMAIN}`,
        username: `deleted+${randomId}`,
        firstName: "Deleted",
        lastName: "User",
        deletedAt: new Date().toISOString(),
      },
    });

    if (contact) {
      /** Delete the user contact info */
      await remove(db, "UserContact", { id: contact.id });
    }

    /**
     * Delete the picture of the user
     *
     * Note: This happens outside of the transaction because we dont want to rollback the deletion of the user if the deletion of the picture fails
     * If it fails for some reason, we will get it in our logs that there was an issue so we can check it manually
     * */
    if (user.profilePicture) {
      await deleteProfilePicture({ url: user.profilePicture });
    }

    /** Delete the auth user. This should also destroy all their current sessions */
    const { error } = await getSupabaseAdmin().auth.admin.deleteUser(
      user.id,
      true // Soft delete
    );

    /** Send an email to the user that their request has been completed */
    void sendEmail({
      to: user.email,
      subject: "Your account has been deleted",
      text: `Your shelf account has been deleted. \n\n Kind regards, \n Shelf Team\n\n`,
    });

    if (error) {
      throw new ShelfError({
        cause: error,
        message: "Failed to delete Auth user",
        additionalData: { id, error },
        label: "Auth",
      });
    }
  } catch (cause) {
    const isNotFound =
      cause &&
      typeof cause === "object" &&
      "code" in cause &&
      cause.code === "PGRST116";

    if (isNotFound) {
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

  // user account created but no session
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
    const teamMember = await findFirst(db, "TeamMember", {
      where: { userId, organizationId },
    });

    if (teamMember?.id) {
      // Disconnect the team member from the user by nullifying the userId
      await update(db, "TeamMember", {
        where: { id: teamMember.id },
        data: { userId: null },
      });
    }

    // Delete the UserOrganization entry
    await remove(db, "UserOrganization", {
      userId,
      organizationId,
    });

    // Clear lastSelectedOrganizationId if it points to the revoked org.
    // Best-effort: don't block revocation if cleanup fails.
    try {
      const currentUser = await findFirst(db, "User", {
        where: { id: userId, lastSelectedOrganizationId: organizationId },
      });
      if (currentUser) {
        await update(db, "User", {
          where: { id: userId },
          data: { lastSelectedOrganizationId: null },
        });
      }
    } catch (cleanupError) {
      Logger.warn(
        "Failed to clear lastSelectedOrganizationId during access revocation",
        userId,
        organizationId,
        cleanupError
      );
    }

    // Return the user for callers that expect it
    return await findUniqueOrThrow(db, "User", { where: { id: userId } });
  } catch (cause) {
    throw new ShelfError({
      cause,
      message: "Failed to revoke user access to organization",
      additionalData: { userId, organizationId },
      label,
    });
  }
}

/**
 * Changes a user's role in an organization in-place.
 * This is the same pattern used by ownership transfer and SCIM sync.
 * Does NOT affect TeamMember, Custody, or Booking records.
 *
 * Caller role validation:
 * - Only OWNER can promote/demote ADMINs
 * - Cannot assign OWNER role
 * - Cannot change the OWNER's role
 *
 * Returns the target user's previous role alongside the updated record.
 */
export async function changeUserRole({
  userId,
  organizationId,
  newRole,
  callerRole,
}: {
  userId: User["id"];
  organizationId: Organization["id"];
  newRole: OrganizationRoles;
  callerRole: OrganizationRoles;
}) {
  try {
    if (newRole === OrganizationRoles.OWNER) {
      throw new ShelfError({
        cause: null,
        message:
          "Cannot assign Owner role directly. Use ownership transfer instead.",
        label,
        shouldBeCaptured: false,
      });
    }

    const userOrg = await findFirst(db, "UserOrganization", {
      where: {
        userId,
        organizationId,
      },
    });

    if (!userOrg) {
      throw new ShelfError({
        cause: null,
        message: "User is not a member of this organization",
        additionalData: { userId, organizationId },
        label,
        shouldBeCaptured: false,
      });
    }

    const currentRole = userOrg.roles[0];

    if (currentRole === OrganizationRoles.OWNER) {
      throw new ShelfError({
        cause: null,
        message:
          "Cannot change the Owner's role. Use ownership transfer instead.",
        label,
        shouldBeCaptured: false,
      });
    }

    /** Only OWNER can promote someone to ADMIN */
    if (
      newRole === OrganizationRoles.ADMIN &&
      callerRole !== OrganizationRoles.OWNER
    ) {
      throw new ShelfError({
        cause: null,
        title: "Insufficient permissions",
        message: "Only the workspace owner can promote users to Administrator.",
        label,
        status: 403,
        shouldBeCaptured: false,
      });
    }

    /** Only OWNER can change an ADMIN's role */
    if (
      currentRole === OrganizationRoles.ADMIN &&
      callerRole !== OrganizationRoles.OWNER
    ) {
      throw new ShelfError({
        cause: null,
        title: "Insufficient permissions",
        message: "Only the workspace owner can change an Administrator's role.",
        label,
        status: 403,
        shouldBeCaptured: false,
      });
    }

    const updated = await update(db, "UserOrganization", {
      where: {
        userId,
        organizationId,
      },
      data: {
        roles: [newRole],
      },
    });

    return { ...updated, previousRole: currentRole };
  } catch (cause) {
    throw new ShelfError({
      cause,
      message: isLikeShelfError(cause)
        ? cause.message
        : "Failed to change user role",
      additionalData: { userId, organizationId, newRole },
      label,
      status: isLikeShelfError(cause) ? cause.status : undefined,
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
 *   - [x] Invite (skippable via `skipInvites`)
 *   - [x] Booking
 *   - [x] Image
 *   - [x] Kit
 *   - [x] AssetReminder
 *
 * Note: Notes (Note, BookingNote, LocationNote) are intentionally NOT
 * transferred — their userId represents authorship, not ownership.
 *
 * Invites can be skipped via `skipInvites` (used during demotion) because
 * inviterId represents "who sent this" (authorship), not ownership.
 */
export async function transferEntitiesToNewOwner({
  id,
  newOwnerId,
  organizationId,
  skipInvites = false,
}: {
  id: User["id"];
  newOwnerId: User["id"];
  organizationId: Organization["id"];
  skipInvites?: boolean;
}) {
  /** Update assets */
  await updateMany(db, "Asset", {
    where: {
      userId: id,
      organizationId: organizationId,
    },
    data: {
      userId: newOwnerId,
    },
  });

  /** Update categories */
  await updateMany(db, "Category", {
    where: {
      userId: id,
      organizationId: organizationId,
    },
    data: {
      userId: newOwnerId,
    },
  });

  /** Update tags */
  await updateMany(db, "Tag", {
    where: {
      userId: id,
      organizationId: organizationId,
    },
    data: {
      userId: newOwnerId,
    },
  });

  /** Update locations */
  await updateMany(db, "Location", {
    where: {
      userId: id,
      organizationId: organizationId,
    },
    data: {
      userId: newOwnerId,
    },
  });

  /** Update custom fields */
  await updateMany(db, "CustomField", {
    where: {
      userId: id,
      organizationId: organizationId,
    },
    data: {
      userId: newOwnerId,
    },
  });

  /** Update invites (skipped during demotion — inviterId is authorship) */
  if (!skipInvites) {
    await updateMany(db, "Invite", {
      where: {
        inviterId: id,
        organizationId: organizationId,
      },
      data: {
        inviterId: newOwnerId,
      },
    });
  }

  /** Update bookings */
  await updateMany(db, "Booking", {
    where: {
      creatorId: id,
      organizationId: organizationId,
    },
    data: {
      creatorId: newOwnerId,
    },
  });

  /** Update bookings where the person deleted is the custodian */
  await updateMany(db, "Booking", {
    where: {
      custodianUserId: id,
      organizationId: organizationId,
    },
    data: {
      custodianUserId: null,
    },
  });

  /** Update images */
  await updateMany(db, "Image", {
    where: {
      userId: id,
      ownerOrgId: organizationId,
    },
    data: {
      userId: newOwnerId,
    },
  });

  /** Update kits */
  await updateMany(db, "Kit", {
    where: {
      createdById: id,
      organizationId: organizationId,
    },
    data: {
      createdById: newOwnerId,
    },
  });

  /** Update asset reminders */
  await updateMany(db, "AssetReminder", {
    where: {
      createdById: id,
      organizationId: organizationId,
    },
    data: {
      createdById: newOwnerId,
    },
  });
}

export async function getUserFromOrg({
  id,
  organizationId,
}: Pick<User, "id"> & {
  organizationId: Organization["id"];
}) {
  try {
    // Check if the user is in this organization
    const userOrg = await findFirst(db, "UserOrganization", {
      where: { userId: id, organizationId },
    });

    if (!userOrg) {
      throw new ShelfError({
        cause: null,
        title: "User not found.",
        message:
          "The user you are trying to access does not exists or you do not have permission to access it.",
        additionalData: { id, organizationId },
        label,
        status: 404,
      });
    }

    const user = await findUniqueOrThrow(db, "User", {
      where: { id },
    });

    // Fetch user organizations
    const userOrganizations = await findMany(db, "UserOrganization", {
      where: { userId: id },
    });

    return { ...user, userOrganizations };
  } catch (cause) {
    throw new ShelfError({
      cause,
      title: "User not found.",
      message:
        "The user you are trying to access does not exists or you do not have permission to access it.",
      additionalData: {
        id,
        organizationId,
        ...(isLikeShelfError(cause) ? cause.additionalData : {}),
      },
      label,
      shouldBeCaptured: !isNotFoundError(cause),
    });
  }
}
