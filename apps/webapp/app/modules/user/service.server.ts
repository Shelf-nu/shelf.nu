import type {
  Organization,
  TierId,
  User,
  UserOrganization,
} from "@prisma/client";
import type { Prisma } from "@prisma/client";
import { Roles, OrganizationRoles, AssetIndexMode } from "@prisma/client";
import type { LoaderFunctionArgs } from "react-router";
import sharp from "sharp";
import type { AuthSession } from "@server/session";
import { config } from "~/config/shelf.config";
import { sbDb } from "~/database/supabase.server";

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
import { type UpdateUserPayload } from "./types";
import { defaultFields } from "../asset-index-settings/helpers";
import { ensureAssetIndexModeForRole } from "../asset-index-settings/service.server";
import { defaultUserCategories } from "../category/default-categories";
import { getOrganizationsBySsoDomain } from "../organization/service.server";
import { createTeamMember } from "../team-member/service.server";
import {
  getUserContactById,
  updateUserContactInfo,
} from "../user-contact/service.server";

const label: ErrorLabel = "User";

/**
 * Build a Supabase select string from a Prisma-style select/include object.
 * Only handles the top-level keys (no nested relations).
 * If no options are provided, returns "id".
 */
function buildSelectString(options?: {
  select?: Record<string, any>;
  include?: Record<string, any>;
}): string {
  if (options?.select) {
    return Object.keys(options.select)
      .filter((k) => options.select![k])
      .join(", ");
  }
  if (options?.include) {
    // include means "all fields + relations"
    return "*";
  }
  return "id";
}

export async function getUserByID(
  id: User["id"],
  options?: { select?: Record<string, any>; include?: Record<string, any> }
): Promise<any> {
  try {
    if (options?.select && options?.include) {
      throw new ShelfError({
        cause: null,
        message:
          "Cannot use both select and include in getUserByID. Please choose one.",
        additionalData: {
          id,
          select: options.select,
          include: options.include,
        },
        label,
      });
    }

    const selectStr = buildSelectString(options);

    const { data, error } = await sbDb
      .from("User")
      .select(selectStr)
      .eq("id", id)
      .single();

    if (error) throw error;

    return data;
  } catch (cause) {
    throw new ShelfError({
      cause,
      title: "User not found",
      message: "The user you are trying to access does not exist.",
      additionalData: { id, ...options },
      label,
    });
  }
}

export async function getUserWithContact(id: string, _include?: any) {
  try {
    const { data: user, error } = await sbDb
      .from("User")
      .select("*")
      .eq("id", id)
      .single();

    if (error) throw error;

    // Fetch contact separately since dynamic select strings lose type info
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
    const { data, error } = await sbDb
      .from("User")
      .select("*")
      .eq("email", email.toLowerCase())
      .maybeSingle();

    if (error) throw error;

    return data;
  } catch (cause) {
    throw new ShelfError({
      cause,
      message: "Failed to find user",
      additionalData: { email },
      label,
    });
  }
}

async function createUserOrgAssociation(payload: {
  roles: OrganizationRoles[];
  organizationIds: Organization["id"][];
  userId: User["id"];
}) {
  const { organizationIds, userId, roles } = payload;

  try {
    return await Promise.all(
      Array.from(new Set(organizationIds)).map(async (organizationId) => {
        // Check if the association already exists
        const { data: existing, error: findError } = await sbDb
          .from("UserOrganization")
          .select("*")
          .eq("userId", userId)
          .eq("organizationId", organizationId)
          .maybeSingle();

        if (findError) throw findError;

        if (existing) {
          // Update: append roles
          const updatedRoles = [...existing.roles, ...roles];
          const { data, error } = await sbDb
            .from("UserOrganization")
            .update({ roles: updatedRoles })
            .eq("userId", userId)
            .eq("organizationId", organizationId)
            .select("*")
            .single();

          if (error) throw error;
          return data;
        } else {
          // Create new association
          const { data, error } = await sbDb
            .from("UserOrganization")
            .insert({ userId, organizationId, roles })
            .select("*")
            .single();

          if (error) throw error;
          return data;
        }
      })
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
    const { data: shelfUser, error: findError } = await sbDb
      .from("User")
      .select(
        "id, email, firstName, lastName, sso, userOrganizations:UserOrganization(roles, organization:Organization(id, name, enabledSso, ssoDetails:SsoDetails(id, domain, baseUserGroupId, selfServiceGroupId, adminGroupId)))"
      )
      .eq("email", email)
      .maybeSingle();

    if (findError) throw findError;

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
    await createUserOrgAssociation({
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
          await createUserOrgAssociation({
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
      const { error } = await sbDb
        .from("UserOrganization")
        .delete()
        .eq("userId", userId)
        .eq("organizationId", organization.id);

      if (error) throw error;

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
      const { error } = await sbDb
        .from("UserOrganization")
        .update({ roles: [desiredRole] })
        .eq("userId", userId)
        .eq("organizationId", organization.id);

      if (error) throw error;

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
  existingUser: any,
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
  user: any;
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
      const { data, error } = await sbDb
        .from("User")
        .update({ firstName, lastName })
        .eq("id", userId)
        .select(
          "id, email, firstName, lastName, sso, userOrganizations:UserOrganization(roles, organization:Organization(id, name, enabledSso, ssoDetails:SsoDetails(id, domain, baseUserGroupId, selfServiceGroupId, adminGroupId)))"
        )
        .single();

      if (error) throw error;
      user = data;
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
          (uo: any) => uo.organization.id === org.id
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
          await createUserOrgAssociation({
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
    // Step 1: Get the Role record for USER
    const { data: roleRecord, error: roleError } = await sbDb
      .from("Role")
      .select("id")
      .eq("name", Roles["USER"])
      .single();

    if (roleError) throw roleError;

    // Step 2: Create the user
    const { data: user, error: userError } = await sbDb
      .from("User")
      .insert({
        id: userId,
        email,
        username,
        firstName: firstName ?? null,
        lastName: lastName ?? null,
        createdWithInvite: createdWithInvite ?? false,
        ...(isSSO && {
          onboarded: true,
          sso: true,
        }),
      })
      .select(
        "id, email, firstName, lastName, sso, userOrganizations:UserOrganization(roles, organization:Organization(id, name, enabledSso, ssoDetails:SsoDetails(id, domain, baseUserGroupId, selfServiceGroupId, adminGroupId)))"
      )
      .single();

    if (userError) throw userError;

    // Step 3: Link user to Role via _RoleToUser join table
    const { error: roleJoinError } = await sbDb
      .from("_RoleToUser")
      .insert({ A: roleRecord.id, B: userId });

    if (roleJoinError) throw roleJoinError;

    let personalOrgId: string | null = null;

    // Step 4: Create personal organization if needed
    if (shouldCreatePersonalOrg) {
      const { data: org, error: orgError } = await sbDb
        .from("Organization")
        .insert({
          name: "Personal",
          userId,
          hasSequentialIdsMigrated: true,
        })
        .select("id")
        .single();

      if (orgError) throw orgError;
      personalOrgId = org.id;

      // Create default categories for the personal org
      const categoryInserts = defaultUserCategories.map((c) => ({
        ...c,
        userId,
        organizationId: org.id,
      }));

      if (categoryInserts.length > 0) {
        const { error: catError } = await sbDb
          .from("Category")
          .insert(categoryInserts);

        if (catError) throw catError;
      }

      // Create team member for the owner
      const memberName = [
        ...[firstName, lastName].filter(Boolean),
        "(Owner)",
      ].join(" ");

      const { error: tmError } = await sbDb.from("TeamMember").insert({
        name: memberName,
        organizationId: org.id,
        userId,
      });

      if (tmError) throw tmError;

      // Create asset index settings for new users' personal org
      const { error: aisError } = await sbDb.from("AssetIndexSettings").insert({
        mode: AssetIndexMode.ADVANCED,
        columns: defaultFields,
        organizationId: org.id,
        userId,
      });

      if (aisError) throw aisError;
    }

    // Step 5: Create user-org associations
    const orgAssociationPromises: Promise<any>[] = [];

    if (shouldCreatePersonalOrg && personalOrgId) {
      orgAssociationPromises.push(
        createUserOrgAssociation({
          userId: user.id,
          organizationIds: [personalOrgId],
          roles: [OrganizationRoles.OWNER],
        })
      );
    }

    if (organizationId && roles?.length) {
      orgAssociationPromises.push(
        createUserOrgAssociation({
          userId: user.id,
          organizationIds: [organizationId],
          roles,
        })
      );
    }

    await Promise.all(orgAssociationPromises);

    // Re-fetch user with full data including the new organizations
    const { data: fullUser, error: fetchError } = await sbDb
      .from("User")
      .select(
        "id, email, firstName, lastName, sso, userOrganizations:UserOrganization(roles, organization:Organization(id, name, enabledSso, ssoDetails:SsoDetails(id, domain, baseUserGroupId, selfServiceGroupId, adminGroupId))), organizations:Organization(id)"
      )
      .eq("id", userId)
      .single();

    if (fetchError) throw fetchError;

    return fullUser;
  } catch (cause) {
    const isUniqueViolation =
      cause &&
      typeof cause === "object" &&
      "code" in cause &&
      (cause as any).code === "23505";

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

export async function updateUser(
  updateUserPayload: UpdateUserPayload,
  _extraIncludes?: any
) {
  /**
   * Remove password from object so we can pass it to user update
   * Also we remove the email as we don't allow it to be changed for now
   * */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const cleanClone = (({ password, confirmPassword, email, ...o }) => o)(
    updateUserPayload
  );

  try {
    // Update user
    const { data: updatedUser, error: updateError } = await sbDb
      .from("User")
      .update(cleanClone)
      .eq("id", updateUserPayload.id)
      .select("*")
      .single();

    if (updateError) throw updateError;

    // Update team members name
    const fullName = `${
      updateUserPayload.firstName ? updateUserPayload.firstName : ""
    } ${updateUserPayload.lastName ? updateUserPayload.lastName : ""}`;

    const { error: tmUpdateError } = await sbDb
      .from("TeamMember")
      .update({ name: fullName })
      .eq("userId", updateUserPayload.id);

    if (tmUpdateError) throw tmUpdateError;

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
      (cause as any).code === "23505";

    if (isUniqueViolation) {
      const target = (cause as any).details?.match(/\((\w+)\)/)?.[1] || "field";
      validationErrors[target] = {
        message: `${target} is already taken.`,
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
    const { data: updatedUser, error: updateError } = await sbDb
      .from("User")
      .update({ email: newEmail })
      .eq("id", userId)
      .select("*")
      .single();

    if (updateError) {
      // On failure, revert the change of the user update in auth
      void getSupabaseAdmin().auth.admin.updateUserById(userId, {
        email: currentEmail,
      });

      throw new ShelfError({
        cause: updateError,
        message: "Failed to update email in shelf",
        additionalData: { userId, newEmail, currentEmail },
        label,
      });
    }

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
  const tierId = searchParams.get("tierId");

  try {
    const { users, totalUsers } = await getUsers({
      page,
      perPage: 25,
      search,
      tierId,
    });
    const totalPages = Math.ceil(totalUsers / 25);

    return {
      page,
      perPage: 25,
      search,
      tierId,
      totalUsers,
      users,
      totalPages,
    };
  } catch (cause) {
    throw new ShelfError({
      cause,
      message: "Failed to get paginated and filterable users",
      additionalData: { page, search, tierId },
      label,
    });
  }
};

async function getUsers({
  page = 1,
  perPage = 8,
  search,
  tierId,
}: {
  /** Page number. Starts at 1 */
  page: number;

  /** Assets to be loaded per page */
  perPage?: number;

  search?: string | null;
  tierId?: string | null;
}) {
  try {
    const take = perPage >= 1 && perPage <= 25 ? perPage : 8; // min 1 and max 25 per page
    const skip = page > 1 ? (page - 1) * take : 0;

    let query = sbDb
      .from("User")
      .select(
        "*, tier:Tier(*), userOrganizations:UserOrganization(roles, organization:Organization(id, type, userId))",
        { count: "exact" }
      )
      .order("createdAt", { ascending: false })
      .range(skip, skip + take - 1);

    /** If the search string exists, add filters */
    if (search) {
      query = query.or(`email.ilike.%${search}%,id.ilike.%${search}%`);
    }

    /** If tierId filter exists, add it */
    if (tierId) {
      query = query.eq("tierId", tierId as TierId);
    }

    const { data: users, error, count } = await query;

    if (error) throw error;

    return { users: users || [], totalUsers: count || 0 };
  } catch (cause) {
    throw new ShelfError({
      cause,
      message: "Failed to get users",
      additionalData: { page, perPage, search, tierId },
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
    const user = await getUserByID(userId, {
      select: { id: true, profilePicture: true } satisfies Prisma.UserSelect,
    });
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
    const user = await getUserByID(id, {
      select: {
        id: true,
        email: true,
        profilePicture: true,
      } satisfies Prisma.UserSelect,
    });

    // Fetch user organizations with org details
    const { data: userOrganizations, error: uoError } = await sbDb
      .from("UserOrganization")
      .select("*, organization:Organization(id, userId)")
      .eq("userId", id);

    if (uoError) throw uoError;

    // Fetch contact
    const { data: contact } = await sbDb
      .from("UserContact")
      .select("id")
      .eq("userId", id)
      .maybeSingle();

    const organizationsTheUserDoesNotOwn = (userOrganizations || []).filter(
      (uo: any) => !uo.roles.includes(OrganizationRoles.OWNER)
    );

    // Sequential operations (replacing transaction)
    for (const userOrg of organizationsTheUserDoesNotOwn) {
      const newOwnerId = (userOrg as any).organization?.userId;

      if (newOwnerId) {
        await transferEntitiesToNewOwner({
          id,
          newOwnerId,
          organizationId: userOrg.organizationId,
        });
      }
      await revokeAccessToOrganization({
        userId: id,
        organizationId: userOrg.organizationId,
      });
    }

    /** Update the user data */
    const randomId = generateId();
    const { error: userUpdateError } = await sbDb
      .from("User")
      .update({
        email: `deleted+${randomId}${SOFT_DELETED_EMAIL_DOMAIN}`,
        username: `deleted+${randomId}`,
        firstName: "Deleted",
        lastName: "User",
        deletedAt: new Date().toISOString(),
      })
      .eq("id", id);

    if (userUpdateError) throw userUpdateError;

    if (contact) {
      /** Delete the user contact info */
      const { error: contactDeleteError } = await sbDb
        .from("UserContact")
        .delete()
        .eq("id", contact.id);

      if (contactDeleteError) throw contactDeleteError;
    }

    /**
     * Delete the picture of the user
     */
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
    if (
      cause &&
      typeof cause === "object" &&
      "code" in cause &&
      (cause as any).code === "PGRST116"
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
    const { data: teamMember } = await sbDb
      .from("TeamMember")
      .select("id")
      .eq("userId", userId)
      .eq("organizationId", organizationId)
      .maybeSingle();

    // Disconnect team member from user if exists
    if (teamMember?.id) {
      const { error: tmError } = await sbDb
        .from("TeamMember")
        .update({ userId: null })
        .eq("id", teamMember.id);

      if (tmError) throw tmError;
    }

    // Delete the UserOrganization entry
    const { error: uoError } = await sbDb
      .from("UserOrganization")
      .delete()
      .eq("userId", userId)
      .eq("organizationId", organizationId);

    if (uoError) throw uoError;

    // Fetch the updated user to return
    const { data: result, error: fetchError } = await sbDb
      .from("User")
      .select("*")
      .eq("id", userId)
      .single();

    if (fetchError) throw fetchError;

    // Clear lastSelectedOrganizationId if it points to the revoked org.
    try {
      const { error: cleanupRpcError } = await sbDb.rpc(
        "clear_user_last_selected_org",
        { user_id: userId, organization_id: organizationId }
      );
      if (cleanupRpcError) throw cleanupRpcError;
    } catch (cleanupError) {
      Logger.warn(
        "Failed to clear lastSelectedOrganizationId during access revocation",
        userId,
        organizationId,
        cleanupError
      );
    }

    return result;
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

    const { data: userOrg, error: findError } = await sbDb
      .from("UserOrganization")
      .select("*")
      .eq("userId", userId)
      .eq("organizationId", organizationId)
      .maybeSingle();

    if (findError) throw findError;

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

    const { data: updated, error: updateError } = await sbDb
      .from("UserOrganization")
      .update({ roles: [newRole] })
      .eq("userId", userId)
      .eq("organizationId", organizationId)
      .select("*")
      .single();

    if (updateError) throw updateError;

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
 * transferred -- their userId represents authorship, not ownership.
 *
 * Invites can be skipped via `skipInvites` (used during demotion) because
 * inviterId represents "who sent this" (authorship), not ownership.
 *
 * Previously required a transaction; now uses sequential calls.
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
  const { error: assetError } = await sbDb
    .from("Asset")
    .update({ userId: newOwnerId })
    .eq("userId", id)
    .eq("organizationId", organizationId);

  if (assetError) throw assetError;

  /** Update categories */
  const { error: catError } = await sbDb
    .from("Category")
    .update({ userId: newOwnerId })
    .eq("userId", id)
    .eq("organizationId", organizationId);

  if (catError) throw catError;

  /** Update tags */
  const { error: tagError } = await sbDb
    .from("Tag")
    .update({ userId: newOwnerId })
    .eq("userId", id)
    .eq("organizationId", organizationId);

  if (tagError) throw tagError;

  /** Update locations */
  const { error: locError } = await sbDb
    .from("Location")
    .update({ userId: newOwnerId })
    .eq("userId", id)
    .eq("organizationId", organizationId);

  if (locError) throw locError;

  /** Update custom fields */
  const { error: cfError } = await sbDb
    .from("CustomField")
    .update({ userId: newOwnerId })
    .eq("userId", id)
    .eq("organizationId", organizationId);

  if (cfError) throw cfError;

  /** Update invites (skipped during demotion -- inviterId is authorship) */
  if (!skipInvites) {
    const { error: invError } = await sbDb
      .from("Invite")
      .update({ inviterId: newOwnerId })
      .eq("inviterId", id)
      .eq("organizationId", organizationId);

    if (invError) throw invError;
  }

  /** Update bookings */
  const { error: bookError } = await sbDb
    .from("Booking")
    .update({ creatorId: newOwnerId })
    .eq("creatorId", id)
    .eq("organizationId", organizationId);

  if (bookError) throw bookError;

  /** Update bookings where the person deleted is the custodian */
  const { error: custError } = await sbDb
    .from("Booking")
    .update({ custodianUserId: null })
    .eq("custodianUserId", id)
    .eq("organizationId", organizationId);

  if (custError) throw custError;

  /** Update images */
  const { error: imgError } = await sbDb
    .from("Image")
    .update({ userId: newOwnerId })
    .eq("userId", id)
    .eq("ownerOrgId", organizationId);

  if (imgError) throw imgError;

  /** Update kits */
  const { error: kitError } = await sbDb
    .from("Kit")
    .update({ createdById: newOwnerId })
    .eq("createdById", id)
    .eq("organizationId", organizationId);

  if (kitError) throw kitError;

  /** Update asset reminders */
  const { error: reminderError } = await sbDb
    .from("AssetReminder")
    .update({ createdById: newOwnerId })
    .eq("createdById", id)
    .eq("organizationId", organizationId);

  if (reminderError) throw reminderError;
}

export async function getUserFromOrg({
  id,
  organizationId,
  userOrganizations,
  request,
}: Pick<User, "id"> & {
  organizationId: Organization["id"];
  userOrganizations?: Pick<UserOrganization, "organizationId">[];
  request?: Request;
}) {
  try {
    // Check if user belongs to the organization (or any of the provided orgs)
    const otherOrganizationIds = userOrganizations?.map(
      (org) => org.organizationId
    );

    // Build the org IDs to check
    const orgIdsToCheck = [
      organizationId,
      ...(otherOrganizationIds || []),
    ].filter(Boolean);

    // First check if user has any of these org memberships
    const { data: userOrgMemberships, error: membershipError } = await sbDb
      .from("UserOrganization")
      .select("organizationId")
      .eq("userId", id)
      .in("organizationId", orgIdsToCheck);

    if (membershipError) throw membershipError;

    if (!userOrgMemberships || userOrgMemberships.length === 0) {
      throw new ShelfError({
        cause: null,
        title: "User not found.",
        message:
          "The user you are trying to access does not exists or you do not have permission to access it.",
        additionalData: { id, organizationId },
        label,
      });
    }

    // Fetch the user with userOrganizations (USER_STATIC_INCLUDE equivalent)
    const { data: user, error: userError } = await sbDb
      .from("User")
      .select("*, userOrganizations:UserOrganization(*)")
      .eq("id", id)
      .single();

    if (userError) throw userError;

    /* User is accessing the User in the wrong organization */
    const userOrgs = (user as any).userOrganizations as any[];
    const isUserInCurrentOrg = !!userOrgs.find(
      (userOrg: any) => userOrg.organizationId === organizationId
    );

    const otherOrgsForUser =
      userOrganizations?.filter(
        (org) =>
          !!userOrgs.find(
            (userOrg: any) => userOrg.organizationId === org.organizationId
          )
      ) ?? [];

    if (
      userOrganizations?.length &&
      !isUserInCurrentOrg &&
      otherOrgsForUser?.length
    ) {
      const redirectTo =
        typeof request !== "undefined"
          ? getRedirectUrlFromRequest(request)
          : undefined;

      throw new ShelfError({
        cause: null,
        title: "User not found",
        message: "",
        additionalData: {
          model: "teamMember",
          organizations: otherOrgsForUser,
          redirectTo,
        },
        label,
        status: 404,
      });
    }

    return user;
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
