/**
 * User Service
 *
 * Server-side user lifecycle: creating users (email, SSO, invite acceptance),
 * attaching them to organizations, reading and updating profiles, and
 * removing or soft-deleting accounts.
 *
 * @see {@link file://./fields.ts}
 * @see {@link file://./utils.server.ts}
 * @see {@link file://./../invite/service.server.ts}
 */
import type {
  Organization,
  TierId,
  User,
  UserOrganization,
} from "@prisma/client";
import {
  Prisma,
  Roles,
  OrganizationRoles,
  AssetIndexMode,
} from "@prisma/client";
import type { ITXClientDenyList } from "@prisma/client/runtime/library";
import { PrismaClientKnownRequestError } from "@prisma/client/runtime/library";
import type { LoaderFunctionArgs } from "react-router";
import sharp from "sharp";
import type { AuthSession } from "@server/session";
import { config } from "~/config/shelf.config";
import type { ExtendedPrismaClient } from "~/database/db.server";
import { db } from "~/database/db.server";

import { SOFT_DELETED_EMAIL_DOMAIN } from "~/emails/email.worker.server";
import { sendEmail } from "~/emails/mail.server";
import { captureServerEvent } from "~/integrations/posthog/client.server";
import { getSupabaseAdmin } from "~/integrations/supabase/client";
import {
  deleteAuthAccount,
  createEmailAuthAccount,
  confirmExistingAuthAccount,
  signInWithEmail,
  updateAccountPassword,
} from "~/modules/auth/service.server";

import { DEFAULT_MAX_IMAGE_UPLOAD_SIZE } from "~/utils/constants";
import type { DetectedFormatPrefs } from "~/utils/date-format";
import { dateTimeInUnix } from "~/utils/date-time-in-unix";
import type { ErrorLabel } from "~/utils/error";
import { ShelfError, isLikeShelfError, isNotFoundError } from "~/utils/error";
import { getRedirectUrlFromRequest, type ValidationError } from "~/utils/http";
import { getCurrentSearchParams } from "~/utils/http.server";
import { id as generateId } from "~/utils/id/id.server";
import { getParamsValues } from "~/utils/list";
import { Logger } from "~/utils/logger";
import type { RoleChangeTransfers } from "~/utils/permissions/membership-access";
import {
  canAssignRole,
  holdsRoleWhere,
  roleChangeRequiresOwner,
  roleChangeTransfers,
} from "~/utils/permissions/membership-access";
import {
  ROLE_LABELS,
  ROLE_POLICIES,
  isWorkspaceOwner,
  resolveRole,
  rolesWhere,
} from "~/utils/permissions/role-access";
import { getRoleFromGroupId } from "~/utils/roles.server";
import { hasSsoGroupMappings } from "~/utils/sso-group-roles";
import {
  deleteProfilePicture,
  getPublicFileURL,
  parseFileFormData,
} from "~/utils/storage.server";
import { randomUsernameFromEmail } from "~/utils/user";
import { USER_WITH_SSO_DETAILS_SELECT } from "./fields";
import type { UpdateUserPayload } from "./types";
import { defaultFields } from "../asset-index-settings/helpers";
import { ensureAssetIndexModeForRole } from "../asset-index-settings/service.server";
import { defaultUserCategories } from "../category/default-categories";
import {
  caseInsensitiveEmailFilter,
  normalizeInviteEmail,
} from "../invite/helpers";
import { getOrganizationsBySsoDomain } from "../organization/service.server";
import { USER_CONTACT_SELECT } from "../user-contact/constants";
import {
  getUserContactById,
  updateUserContactInfo,
} from "../user-contact/service.server";

const label: ErrorLabel = "User";

export function getUserByID<TSelect extends Prisma.UserSelect>(
  id: User["id"],
  options: { select: TSelect; include?: never }
): Promise<Prisma.UserGetPayload<{ select: TSelect }>>;

// Overload 2: With include
export function getUserByID<TInclude extends Prisma.UserInclude>(
  id: User["id"],
  options: { include: TInclude; select?: never }
): Promise<Prisma.UserGetPayload<{ include: TInclude }>>;

// Overload 3: Without options (default)
export function getUserByID(id: User["id"]): Promise<Pick<User, "id">>;

// Implementation
export async function getUserByID(
  id: User["id"],
  options?: { select?: Prisma.UserSelect; include?: Prisma.UserInclude }
): Promise<any> {
  try {
    const select = options?.select;
    const include = options?.include;

    if (select && include) {
      throw new ShelfError({
        cause: null,
        message:
          "Cannot use both select and include in getUserByID. Please choose one.",
        additionalData: { id, select, include },
        label,
      });
    }

    const user = await db.user.findUniqueOrThrow({
      where: { id },
      ...(select
        ? { select }
        : include
        ? { include }
        : { select: { id: true } }),
    });

    return user;
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

export async function getUserWithContact<T extends Prisma.UserInclude>(
  id: string,
  include?: T
) {
  type ReturnType = Prisma.UserGetPayload<{
    include: T & { contact: true };
  }> & {
    contact: NonNullable<
      Prisma.UserContactGetPayload<{
        select: typeof USER_CONTACT_SELECT;
      }>
    >; // Guarantee contact is never null
  };

  try {
    const user = await db.user.findUniqueOrThrow({
      where: { id },
      include: {
        ...include,
        contact: {
          select: USER_CONTACT_SELECT,
        },
      },
    });

    // If contact exists, return user as-is
    if (user.contact) {
      return user as ReturnType;
    }

    // If no contact, create it and attach to user object
    const contact = await getUserContactById(id);

    return {
      ...user,
      contact,
    } as ReturnType;
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

/**
 * Makes sure an SSO user has a `TeamMember` in an organization they can access.
 *
 * Org access and the team-member record are two writes, and only the second one
 * makes custody possible — a user holding the first without the second can sign
 * in, see the workspace, and never be assignable as a custodian. Existing
 * access alone is therefore not taken as proof the pair is intact: a login that
 * still maps to a role re-checks, so an account left half-written can recover.
 * A login that maps to no role does not, because that transition is removing
 * the user's access rather than restoring it.
 *
 * Soft-deleted records do not count: a member removed from the workspace and
 * then re-granted access needs a live record again.
 *
 * @param tx - Prisma client or active transaction
 * @param params.userId - The signing-in user
 * @param params.organizationId - Organization they hold access to
 * @param params.name - Display name for a record that has to be created
 */
async function ensureUserTeamMember(
  tx: Omit<ExtendedPrismaClient, ITXClientDenyList>,
  {
    userId,
    organizationId,
    name,
  }: {
    userId: User["id"];
    organizationId: Organization["id"];
    name: string;
  }
) {
  const existing = await tx.teamMember.findFirst({
    where: { userId, organizationId, deletedAt: null },
    select: { id: true },
  });

  if (existing) {
    return existing;
  }

  return tx.teamMember.create({
    data: { name, organizationId, userId },
    select: { id: true },
  });
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

/**
 * Gives an invitee access to an organization when they accept an invite.
 *
 * When a user with the email exists (matched without regard to letter case),
 * the organization is attached to that user with the invite's roles. When no
 * user exists, a Supabase auth account is created (or an existing auth
 * account without a user row is confirmed) and a new user is created in the
 * organization.
 *
 * @param args.email - The invitee email, normalised by the caller
 * @param args.organizationId - The organization the invite is for
 * @param args.roles - The roles the invite grants
 * @param args.password - The password for a newly created auth account
 * @param args.firstName - First name for a newly created user
 * @param args.lastName - Last name for a newly created user
 * @param args.createdWithInvite - Marks a newly created user as invited
 * @param args.formatPrefs - Browser-detected date/time preferences for a new user
 * @returns The existing or newly created user
 * @throws {ShelfError} When no auth account can be created or confirmed, or
 *   when the user or the organization association cannot be written
 */
export async function createUserOrAttachOrg({
  email,
  organizationId,
  roles,
  password,
  firstName,
  lastName,
  createdWithInvite = false,
  formatPrefs,
}: Pick<User, "email" | "firstName"> &
  Partial<Pick<User, "lastName">> & {
    organizationId: Organization["id"];
    roles: OrganizationRoles[];
    password: string;
    createdWithInvite: boolean;
    /** Browser-detected prefs threaded down from the invite-accept action. */
    formatPrefs?: DetectedFormatPrefs;
  }) {
  try {
    /**
     * `User.email` can contain capitals, so the existing account is matched
     * without regard to letter case. When rows differ only by case, the
     * lowercase row wins, because that is the form sign-in uses; where no row
     * carries that form, the oldest one does. Order the query: without it the
     * fallback returns whichever row Postgres happened to read first, so the
     * same invite can attach to a different account on a later call.
     */
    const matchingUsers = await db.user.findMany({
      where: { email: caseInsensitiveEmailFilter(email) },
      select: USER_WITH_SSO_DETAILS_SELECT,
      orderBy: { createdAt: "asc" },
    });
    const shelfUser =
      matchingUsers.find(
        (user) => user.email === normalizeInviteEmail(email)
      ) ?? matchingUsers[0];

    // If no Prisma User exists, create one.
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
        formatPrefs,
      });

      await ensureAssetIndexModeForRole({
        userId: newUser.id,
        organizationId,
        // The effective (highest) role of the invite, whatever its order.
        role: resolveRole(roles),
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
      role: resolveRole(roles),
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
  },
  /** Browser-detected prefs from the SSO callback action; stamped on the new row. */
  formatPrefs?: DetectedFormatPrefs
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
      formatPrefs,
    });

    // Update contact information if provided
    if (contactInfo) {
      await updateUserContactInfo(userId, contactInfo);
    }

    // Rest of the existing SSO logic for organizations...
    const organizations = await getOrganizationsBySsoDomain(emailDomain);
    let firstMatchedOrg: (typeof organizations)[number] | null = null;

    for (const org of organizations) {
      const { ssoDetails } = org;
      if (!ssoDetails) continue;

      const hasGroupMappings = hasSsoGroupMappings(ssoDetails);

      if (hasGroupMappings) {
        const role = getRoleFromGroupId(ssoDetails, groups);

        if (role) {
          firstMatchedOrg ??= org;
          // Both writes or neither, for the same reason as the returning-user
          // path: access without a team member is an account that can open the
          // workspace but can never be assigned custody.
          await db.$transaction(async (tx) => {
            await createUserOrgAssociation(tx, {
              userId: user.id,
              organizationIds: [org.id],
              roles: [role],
            });

            await ensureUserTeamMember(tx, {
              userId,
              organizationId: org.id,
              name: `${firstName} ${lastName}`,
            });
          });
        }
      }
    }

    // Return the first org that actually matched the user's groups, or
    // null so the OAuth callback redirects to the "pending assignment" page.
    return { user, org: firstMatchedOrg };
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
  /** Whether the user still has access to the workspace after the transition. */
  hasAccess: boolean;
}

/**
 * Reconciles one workspace's membership against the SAML group claims presented
 * at login.
 *
 * The only caller is {@link updateUserFromSSO}'s group-mapping loop. This is
 * the SAML group-claim path, not SCIM, which has its own lifecycle in
 * `~/modules/scim/service.server`. Runs on EVERY SSO login, once per workspace
 * on the user's email domain.
 *
 * Every branch runs in ONE transaction that takes the membership lock
 * ({@link lockMembership}) first and decides from the row it re-reads under
 * that lock, never from the login's snapshot (`currentRoles`): the membership
 * may have been revoked, or ownership transferred to this user, since the
 * snapshot was read.
 *
 * - No membership any more: nothing is written; the user has no access.
 * - The workspace owner (OWNER anywhere in the membership) is never changed by
 *   a group mapping: the membership is kept as-is and nothing moves. A warning
 *   is logged only when the groups map to no role, i.e. would have revoked the
 *   owner's access. Removing the owner would strand the workspace, and throwing
 *   would lock the owner out on the way in; an operator must transfer
 *   ownership before the IdP can deprovision them.
 * - No mapped role: access is revoked by {@link revokeMembershipInTx}, the same
 *   revocation behind the admin "revoke access" UI and SCIM. It deletes the
 *   membership and disconnects EVERY `TeamMember` linked to the user in the
 *   workspace (rows survive, so custody and booking history keep a name). The
 *   disconnect is load-bearing: the booking notification resolver and the
 *   `usersOnly` custodian pickers read straight through `TeamMember.user` with
 *   no membership check. `lastSelectedOrganizationId` is cleared after commit.
 * - A mapped role: the same steps, in the same order, as a manual role change
 *   (`changeUserRole` with no acting member, then `transferOnRoleChange` with
 *   the workspace owner as recipient), and a changed effective role is recorded
 *   in `RoleChangeLog` with `source: SSO` and the member as `changedById`.
 *
 * ERROR SEMANTICS: deliberately fail closed. Any failure aborts the whole login
 * rather than being logged and skipped per workspace: swallowing it would leave
 * the user signed in holding access this call exists to change. The
 * transaction cannot half-apply. This includes failures that repeat on every
 * attempt: a transfer recipient (`organization.userId`) that is missing, is the
 * member themself, or holds no eligible membership, and a transaction that
 * exceeds its timeout while moving a large member's records. Each fails that
 * member's SSO login closed on every attempt until an operator fixes the data
 * (for the recipient, the workspace's owner row).
 *
 * @param userId - The Shelf user signing in
 * @param organization - The workspace; `userId` is its owner, the transfer
 *   recipient
 * @param currentRoles - Roles the login read for the user in it (reported as
 *   `previousRoles`; not used for any decision)
 * @param desiredRole - Role the group claims map to, or `null` to revoke
 * @returns Transition details, including whether the user keeps access
 */
async function reconcileSsoGroupMembership(
  userId: string,
  organization: Organization,
  currentRoles: OrganizationRoles[],
  desiredRole: OrganizationRoles | null
): Promise<UserOrgTransition> {
  const base = {
    userId,
    organizationId: organization.id,
    previousRoles: currentRoles,
  };

  try {
    const outcome = await db.$transaction(async (tx) => {
      const persisted = await lockMembership(tx, {
        userId,
        organizationId: organization.id,
      });

      if (!persisted) {
        return { kind: "gone" as const };
      }
      if (isWorkspaceOwner(persisted.roles)) {
        return { kind: "owner" as const, roles: persisted.roles };
      }

      if (!desiredRole) {
        // Re-takes the lock this transaction already holds, which is a no-op.
        // No acting member, so the owner-only revoke rule does not apply.
        await revokeMembershipInTx(tx, {
          userId,
          organizationId: organization.id,
        });
        return { kind: "revoked" as const, roles: persisted.roles };
      }

      const previousRole = resolveRole(persisted.roles);

      // Same order as the manual role change: write the role, then move what
      // the change moves (decided from the roles read under the lock), then
      // record it.
      await changeUserRole({
        userId,
        organizationId: organization.id,
        newRole: desiredRole,
        actorOwnsWorkspace: null,
        tx,
      });

      await transferOnRoleChange({
        tx,
        targetUserId: userId,
        organizationId: organization.id,
        fromRoles: persisted.roles,
        toRole: desiredRole,
        recipientId: organization.userId,
      });

      // The role write also collapses a mixed membership to one role; only a
      // change of the effective role is recorded.
      if (previousRole !== desiredRole) {
        await tx.roleChangeLog.create({
          data: {
            userId,
            // No admin acted: the member's own login applied their IdP groups.
            changedById: userId,
            source: "SSO",
            organizationId: organization.id,
            previousRole,
            newRole: desiredRole,
          },
        });
      }

      return { kind: "changed" as const, role: desiredRole };
    });

    switch (outcome.kind) {
      case "gone":
        return {
          ...base,
          newRole: null,
          transitionType: "ACCESS_REVOKED",
          hasAccess: false,
        };
      case "owner":
        // An owner is never mapped to OWNER, so a mapped role is the ordinary
        // case (the owner sits in the admin group). Only a claim set that maps
        // to no role puts the owner's access at risk, and that needs an
        // operator: ownership must move before the IdP can deprovision them.
        if (!desiredRole) {
          Logger.warn({
            message:
              "SSO group claims would have revoked the workspace owner's access; kept it unchanged",
            additionalData: {
              userId,
              organizationId: organization.id,
            },
          });
        }
        return {
          ...base,
          newRole: resolveRole(outcome.roles),
          transitionType: "ROLE_CHANGE",
          hasAccess: true,
        };
      case "revoked":
        await clearLastSelectedOrganization({
          userId,
          organizationId: organization.id,
        });
        Logger.info({
          message: "Revoked user access due to SSO group claim changes",
          additionalData: {
            userId,
            organizationId: organization.id,
            previousRoles: outcome.roles,
          },
        });
        return {
          ...base,
          newRole: null,
          transitionType: "ACCESS_REVOKED",
          hasAccess: false,
        };
      case "changed":
        Logger.info({
          message: "Updated user role based on SSO group claims",
          additionalData: {
            userId,
            organizationId: organization.id,
            previousRoles: currentRoles,
            newRole: outcome.role,
          },
        });
        return {
          ...base,
          newRole: outcome.role,
          transitionType: "ROLE_CHANGE",
          hasAccess: true,
        };
    }
  } catch (cause) {
    throw new ShelfError({
      cause,
      message: "Failed to reconcile SSO group membership",
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
/**
 * Whether SCIM has deliberately deactivated this user in this organization.
 *
 * SCIM represents deactivation as "mapping row survives, membership removed"
 * (see `~/modules/scim/service.server`), so a `UserScimExternalId` with no
 * matching `UserOrganization` is a user the IdP has switched off — not one who
 * was never provisioned.
 *
 * The distinction matters on SSO login: without it, group claims that still
 * grant a role would immediately re-create the membership SCIM just removed,
 * letting a deprovisioned user back in — potentially as an admin — whenever
 * group propagation lags behind the SCIM deactivation, or whenever group
 * membership is managed separately from SCIM scoping. A user SCIM never touched
 * has no mapping, so normal SSO provisioning is unaffected.
 *
 * This infers state rather than reading it; an explicit SCIM lifecycle column is
 * the robust fix and is deferred to the lifecycle-state work.
 *
 * @param userId - The Shelf user signing in
 * @param organizationId - The org whose group mapping matched
 * @returns `true` when SCIM manages this user here and has removed their access
 */
async function isScimDeactivated(
  userId: string,
  organizationId: string
): Promise<boolean> {
  const mapping = await db.userScimExternalId.findUnique({
    where: { userId_organizationId: { userId, organizationId } },
    select: { id: true },
  });

  if (mapping) {
    Logger.info(
      `SSO login: skipping role grant for user ${userId} in org ${organizationId} — SCIM has deactivated them`
    );
  }

  return !!mapping;
}

export async function updateUserFromSSO(
  authSession: AuthSession,
  existingUser: Prisma.UserGetPayload<{
    select: typeof USER_WITH_SSO_DETAILS_SELECT;
  }>,
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
  user: Prisma.UserGetPayload<{ select: typeof USER_WITH_SSO_DETAILS_SELECT }>;
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
      user = await db.user.update({
        where: { id: userId },
        data: { firstName, lastName },
        select: USER_WITH_SSO_DETAILS_SELECT,
      });
    }

    // Update contact information if provided
    if (contactInfo) {
      await updateUserContactInfo(userId, contactInfo);
    }

    // Rest of the existing SSO organization logic...
    const domainOrganizations = await getOrganizationsBySsoDomain(emailDomain);
    const existingUserOrganizations = user.userOrganizations;

    const transitions: UserOrgTransition[] = [];
    let firstMatchedOrg: (typeof domainOrganizations)[number] | null = null;

    for (const org of domainOrganizations) {
      const { ssoDetails } = org;
      if (!ssoDetails) continue;

      const hasGroupMappings = hasSsoGroupMappings(ssoDetails);

      if (hasGroupMappings) {
        const desiredRole = getRoleFromGroupId(ssoDetails, groups);
        const existingOrgAccess = existingUserOrganizations.find(
          (uo) => uo.organization.id === org.id
        );

        if (existingOrgAccess) {
          const transition = await reconcileSsoGroupMembership(
            userId,
            org,
            existingOrgAccess.roles,
            desiredRole
          );
          transitions.push(transition);

          // Repair an account whose team-member record never got written,
          // only while the user keeps access: a revoked transition is removing
          // this user's access rather than restoring it. A workspace owner
          // keeps access even when no group claim maps to a role.
          if (transition.hasAccess) {
            await db.$transaction(async (tx) => {
              // `TeamMember` has no uniqueness on (userId, organizationId), so
              // two logins arriving together would both find nothing and both
              // insert, leaving one user with two live custodian records. The
              // membership row does have that uniqueness and always exists on
              // this branch, so locking it serialises the pair of repairs.
              const membership = await tx.$queryRaw<{ id: string }[]>`
                SELECT id FROM "UserOrganization"
                WHERE "userId" = ${userId} AND "organizationId" = ${org.id}
                FOR UPDATE
              `;

              // The transition committed before this transaction opened, so a
              // concurrent callback whose group claims revoke access can delete
              // the row in between. Creating the record anyway would leave a
              // custodian attached to a workspace its user is no longer in.
              if (!membership || membership.length === 0) {
                return;
              }

              await ensureUserTeamMember(tx, {
                userId,
                organizationId: org.id,
                name: `${firstName} ${lastName}`,
              });
            });
          }

          // The org is a landing org whenever the user keeps access,
          // including an owner whose groups no longer map to a role.
          if (transition.hasAccess) {
            firstMatchedOrg ??= org;
          }
        } else if (desiredRole && !(await isScimDeactivated(user.id, org.id))) {
          // Both writes or neither: access without a team member is a state
          // this flow cannot reach again, because the next login would find
          // the access and take the branch above.
          await db.$transaction(async (tx) => {
            await createUserOrgAssociation(tx, {
              userId: user.id,
              organizationIds: [org.id],
              roles: [desiredRole],
            });

            await ensureUserTeamMember(tx, {
              userId,
              organizationId: org.id,
              name: `${firstName} ${lastName}`,
            });
          });

          transitions.push({
            userId,
            organizationId: org.id,
            previousRoles: [],
            newRole: desiredRole,
            transitionType: "ACCESS_GRANTED",
            hasAccess: true,
          });

          // Access was just granted, so this org is a valid landing org.
          firstMatchedOrg ??= org;
        }
        // Deliberately no `firstMatchedOrg` assignment when the grant is blocked
        // (SCIM-deactivated user): returning an org the user cannot access sends
        // the SSO callback to a 403 instead of /sso-pending-assignment.
      }
    }

    return {
      user,
      org: firstMatchedOrg,
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
    /** Browser-detected prefs to stamp on the new row; undefined → resolved at read time. */
    formatPrefs?: DetectedFormatPrefs;
    skipPersonalOrg?: boolean;
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
    formatPrefs,
    skipPersonalOrg,
  } = payload;

  /**
   * We only create a personal org if the signup is not disabled
   * and the caller hasn't opted out (e.g. SCIM provisioning)
   */
  const shouldCreatePersonalOrg = !skipPersonalOrg && !config.disableSignup;

  try {
    const createdUser = await db.$transaction(
      async (tx) => {
        const user = await tx.user.create({
          data: {
            email,
            id: userId,
            username,
            firstName,
            lastName,
            createdWithInvite,
            // Stamp browser-detected date/time/week/timezone prefs when supplied.
            // `{...undefined}` is a no-op, so unset prefs leave the columns null.
            ...formatPrefs,
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
                    hasSequentialIdsMigrated: true, // New personal organizations don't need migration
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
                        name: [
                          ...[firstName, lastName].filter(Boolean),
                          "(Owner)",
                        ].join(" "),
                        user: { connect: { id: userId } },
                      },
                    },
                    // Creating asset index settings for new users' personal org
                    assetIndexSettings: {
                      create: {
                        mode: AssetIndexMode.ADVANCED,
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
          select: {
            ...USER_WITH_SSO_DETAILS_SELECT,
            organizations: {
              select: {
                id: true,
              },
            },
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

    /**
     * Best-effort funnel analytics: a brand-new account was created. Fire-and-
     * forget — never throws and is a no-op when PostHog is unconfigured, so it
     * cannot affect signup. `created_with_invite` / `is_sso` let the funnel
     * isolate genuine self-serve signups downstream.
     */
    captureServerEvent({
      distinctId: userId,
      event: "signup_completed",
      properties: {
        created_with_invite: Boolean(createdWithInvite),
        is_sso: Boolean(isSSO),
      },
    });

    return createdUser;
  } catch (cause) {
    const isUniqueViolation =
      cause instanceof PrismaClientKnownRequestError && cause.code === "P2002";

    /**
     * Idempotency on `id`: a P2002 unique-constraint violation on the primary
     * key means a `User` row already exists for this Supabase auth id, for
     * example on a re-signup, or when the stored email differs from the
     * sign-in email so the route's email-keyed guard does not see the row.
     * The `user.create` and all its side-effects (personal org, org
     * association, team member, asset index settings) run inside one
     * `$transaction`, so the violation rolls all of them back. The existing
     * row is returned, with the same select shape the create returns.
     *
     * For invite and SSO callers (`organizationId` present), the rolled-back
     * transaction did not create the requested org association, so it is
     * restored below. The personal-org / OTP self-signup case has no
     * `organizationId` and needs nothing else.
     *
     * The `signup_completed` analytics event does not fire on this path,
     * because no account was created. When the lookup finds no row (a P2002 on
     * another unique field, such as `email`), it is a real conflict and the
     * error is thrown.
     */
    if (isUniqueViolation) {
      const existingUser = await db.user.findUnique({
        where: { id: userId },
        select: {
          ...USER_WITH_SSO_DETAILS_SELECT,
          organizations: {
            select: {
              id: true,
            },
          },
        },
      });

      if (existingUser) {
        // Restore the org association the rolled-back transaction did not
        // write. Attach only when the user is not a member yet: the upsert's
        // update branch pushes roles, so running it for a member would add
        // the roles a second time.
        if (
          organizationId &&
          !existingUser.organizations.some((org) => org.id === organizationId)
        ) {
          await createUserOrgAssociation(db, {
            userId,
            organizationIds: [organizationId],
            roles: roles ?? [],
          });
          existingUser.organizations.push({ id: organizationId });
        }
        return existingUser;
      }
    }

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

export async function updateUser<T extends Prisma.UserInclude>(
  updateUserPayload: UpdateUserPayload,
  extraIncludes?: T
) {
  /**
   * Remove password from object so we can pass it to prisma user update
   * Also we remove the email as we don't allow it to be changed for now
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
              name:
                updateUserPayload.displayName ||
                `${updateUserPayload.firstName || ""} ${
                  updateUserPayload.lastName || ""
                }`.trim(),
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
      .catch(async (cause) => {
        // Auth already holds the new address, so the revert is what keeps the
        // two systems agreeing. It has to be awaited: sign-in resolves the
        // account by its AUTH email and then looks the user up by that address
        // in the database, so a divergence locks the account out of both apps
        // with no way back in. A dropped promise would also reject unhandled.
        const { error: revertError } = await getSupabaseAdmin()
          .auth.admin.updateUserById(userId, { email: currentEmail })
          .catch((revertCause: unknown) => ({ error: revertCause }));

        if (revertError) {
          // Nothing further can be done from here, so say plainly which
          // address each system holds — repairing it means setting one of
          // them by hand.
          Logger.error(
            new ShelfError({
              cause: revertError,
              message:
                "Email change failed and could not be rolled back in auth. The auth account and the database now hold different addresses, which blocks sign-in until one is corrected.",
              additionalData: { userId, newEmail, currentEmail },
              label,
            })
          );

          throw new ShelfError({
            cause,
            message:
              "Failed to update your email, and we could not restore the previous one. Please contact support before signing out.",
            additionalData: { userId, newEmail, currentEmail },
            label,
          });
        }

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
      // The steps above already say which of the two systems refused, and
      // whether the previous address was restored. Replacing that with one
      // generic line would drop the only guidance the user gets.
      message: isLikeShelfError(cause)
        ? cause.message
        : "Failed to update email",
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
    const skip = page > 1 ? (page - 1) * perPage : 0;
    const take = perPage >= 1 && perPage <= 25 ? perPage : 8; // min 1 and max 25 per page

    /** Default value of where. Takes the assets belonging to current user */
    const where: Prisma.UserWhereInput = {};

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

    /** If tierId filter exists, add it to the where object */
    if (tierId) {
      where.tierId = tierId as TierId;
    }

    const [users, totalUsers] = await Promise.all([
      /** Get the users */
      db.user.findMany({
        skip,
        take,
        where,
        orderBy: { createdAt: "desc" },
        include: {
          tier: true,
          userOrganizations: {
            select: {
              roles: true,
              organization: {
                select: {
                  id: true,
                  type: true,
                  userId: true,
                  // The workspace's billing party. An invited member sits on
                  // the free tier whatever their team pays for, so the admin
                  // list's account status reads the owner's tier, not theirs.
                  owner: { select: { tierId: true } },
                },
              },
            },
          },
        },
      }),

      /** Count them */
      db.user.count({ where }),
    ]);

    return { users, totalUsers };
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
        userOrganizations: {
          include: {
            organization: {
              select: { id: true, userId: true },
            },
          },
        },
        contact: {
          select: {
            id: true,
          },
        },
      } satisfies Prisma.UserSelect,
    });

    const organizationsTheUserDoesNotOwn = user.userOrganizations.filter(
      (uo) => !isWorkspaceOwner(uo.roles)
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
      // Lock every membership being removed before any write, in
      // `organizationId` order, so this deletion never holds one workspace's
      // lock and a user-row write while waiting on another workspace's lock.
      // Every role-change and removal path takes the membership lock before
      // its writes (see lockMembership).
      const membershipsToRemove = [...organizationsTheUserDoesNotOwn].sort(
        (a, b) => a.organizationId.localeCompare(b.organizationId)
      );
      for (const userOrg of membershipsToRemove) {
        const persisted = await lockMembership(tx, {
          userId: id,
          organizationId: userOrg.organizationId,
        });

        if (persisted && isWorkspaceOwner(persisted.roles)) {
          // They became the owner after the user was read: stop, as revoking
          // would, so the whole deletion rolls back with nothing moved.
          throw new ShelfError({
            cause: null,
            message:
              "This user now owns a workspace. Transfer ownership first, then delete the account.",
            additionalData: {
              userId: id,
              organizationId: userOrg.organizationId,
            },
            label,
            status: 400,
            shouldBeCaptured: false,
          });
        }
      }

      for (const userOrg of membershipsToRemove) {
        // Entities move even when the membership is already gone: they still
        // belong to the user being deleted.
        const newOwnerId = userOrg.organization?.userId;

        if (newOwnerId) {
          await transferEntitiesToNewOwner({
            tx,
            id,
            newOwnerId,
            organizationId: userOrg.organizationId,
            reason: "removal",
          });
        }

        /** Remove the user from the workspace, inside this transaction. */
        await revokeMembershipInTx(tx, {
          userId: id,
          organizationId: userOrg.organizationId,
        });
      }

      /** Update the user data */

      const randomId = generateId();
      await tx.user.update({
        where: { id },
        data: {
          email: `deleted+${randomId}${SOFT_DELETED_EMAIL_DOMAIN}`,
          username: `deleted+${randomId}`,
          firstName: "Deleted",
          lastName: "User",
          deletedAt: new Date(),
        },
      });
      if (user.contact) {
        /** Delete the user contact info */
        await tx.userContact.delete({
          where: { id: user.contact.id },
        });
      }
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
      // If the auth user is already gone (e.g., deleted externally),
      // that's fine — we can proceed with the rest of the cleanup
      const isUserNotFound =
        error.status === 404 ||
        ("code" in error && error.code === "user_not_found");

      if (!isUserNotFound) {
        throw new ShelfError({
          cause: error,
          message: "Failed to delete Auth user",
          additionalData: { id, error },
          label: "Auth",
        });
      }
    }
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

/**
 * Deletes a user's membership row unless they own the workspace.
 *
 * A workspace must always have an owner, and deleting the owner's
 * `UserOrganization` row is a one-way door: it is the record
 * `transferOwnership` looks up to hand ownership on. Once gone,
 * `Organization.userId` still names the ex-owner but they have no membership,
 * so they get a 403 and no transfer path can run.
 *
 * The owner condition lives **in the DELETE itself** rather than in a preceding
 * read. A check-then-delete loses to an ownership transfer that commits in
 * between: the read sees ADMIN, the transfer promotes them to OWNER, and the
 * unqualified delete removes the new owner anyway. As a conditional delete this
 * is a compare-and-set — Postgres re-evaluates the qualification against the
 * committed row version, so the race arm matches nothing.
 *
 * @param args - The membership to remove
 * @param client - Transaction client, when the caller needs this to commit with
 *   other writes
 * @returns Number of rows deleted: 0 means the user owns the workspace or has
 *   no membership — the caller must decide which and how to react
 */
async function deleteMembershipUnlessOwner(
  {
    userId,
    organizationId,
  }: { userId: User["id"]; organizationId: Organization["id"] },
  client: Omit<ExtendedPrismaClient, ITXClientDenyList> = db
) {
  const { count } = await client.userOrganization.deleteMany({
    where: {
      userId,
      organizationId,
      NOT: {
        roles: { hasSome: rolesWhere((p) => p.membership.ownsWorkspace) },
      },
    },
  });

  return count;
}

/**
 * Locks a membership row and returns its roles as persisted now.
 *
 * The manual change-role action (`resolveUserAction`'s `"changeRole"` case),
 * the SSO group reconciler (`reconcileSsoGroupMembership`), account deletion
 * (`softDeleteUser`) and membership revocation (`revokeMembershipInTx`) call
 * this FIRST in their transaction, before any entity write, so concurrent
 * role changes and removals on the same member queue on this lock instead of
 * each holding a lock the other needs. `transferOwnership` is the one
 * role-changing path that does not take it: it decides eligibility from a
 * pre-transaction read of both memberships. Decide from the returned roles,
 * never from a snapshot read before the transaction.
 *
 * @param tx - The surrounding transaction
 * @param args.userId - The member
 * @param args.organizationId - The workspace
 * @returns The persisted roles, or `null` when the membership no longer exists
 */
export async function lockMembership(
  tx: Omit<ExtendedPrismaClient, ITXClientDenyList>,
  {
    userId,
    organizationId,
  }: { userId: User["id"]; organizationId: Organization["id"] }
): Promise<{ roles: OrganizationRoles[] } | null> {
  await tx.$queryRaw`
    SELECT id FROM "UserOrganization"
    WHERE "userId" = ${userId} AND "organizationId" = ${organizationId}
    FOR UPDATE
  `;

  return tx.userOrganization.findUnique({
    where: { userId_organizationId: { userId, organizationId } },
    select: { roles: true },
  });
}

/**
 * Removes a member from a workspace inside the caller's transaction: takes the
 * membership lock, refuses the owner, deletes the membership and disconnects
 * every team member linked to the user in that workspace.
 *
 * A membership that no longer exists is not an error: the team-member links
 * are still cleared. Clearing `lastSelectedOrganizationId` is left to the
 * caller, after commit (see {@link clearLastSelectedOrganization}).
 *
 * @param tx - The surrounding transaction
 * @param args.userId - The member losing access
 * @param args.organizationId - The workspace
 * @param args.actorOwnsWorkspace - For a member revoking another member:
 *   `access.ownsWorkspace` of the actor. Left undefined by system callers
 *   (SSO, SCIM, account deletion), which are not bound by the owner-only rule.
 * @returns The updated user row
 * @throws {ShelfError} 400 when the member owns the workspace; 403 when the
 *   actor does not own the workspace and the member's effective role needs
 *   the owner to change it
 */
export async function revokeMembershipInTx(
  tx: Omit<ExtendedPrismaClient, ITXClientDenyList>,
  {
    userId,
    organizationId,
    actorOwnsWorkspace,
  }: {
    userId: User["id"];
    organizationId: Organization["id"];
    actorOwnsWorkspace?: boolean;
  }
) {
  const persisted = await lockMembership(tx, { userId, organizationId });

  if (persisted && isWorkspaceOwner(persisted.roles)) {
    throw new ShelfError({
      cause: null,
      title: "Cannot revoke the owner's access",
      message:
        "This user owns the workspace. Transfer ownership to someone else first, then revoke their access.",
      additionalData: { userId, organizationId },
      label,
      status: 400,
      shouldBeCaptured: false,
    });
  }

  // Decided on the row read under the lock: a promotion that commits after
  // any earlier read is still seen here.
  if (actorOwnsWorkspace === false && persisted) {
    const targetRole = resolveRole(persisted.roles);
    if (roleChangeRequiresOwner(targetRole)) {
      throw new ShelfError({
        cause: null,
        title: "Insufficient permissions",
        message: `Only the workspace owner can revoke access for a member with the ${ROLE_LABELS[targetRole]} role.`,
        additionalData: { userId, organizationId },
        label,
        status: 403,
        shouldBeCaptured: false,
      });
    }
  }

  // Disconnect EVERY linked team member, not just the first: the schema does
  // not enforce one per (user, org), and a row left linked keeps routing
  // booking emails and recipient pickers to a user who no longer has access.
  const teamMembers = await tx.teamMember.findMany({
    where: { userId, organizationId },
    select: { id: true },
  });

  // The conditional delete stays the enforcing check for the owner rule; under
  // the lock it can only match nothing when the membership is already gone.
  await deleteMembershipUnlessOwner({ userId, organizationId }, tx);

  return tx.user.update({
    where: { id: userId },
    data: {
      ...(teamMembers.length > 0 && {
        teamMembers: {
          disconnect: teamMembers.map(({ id }) => ({ id })),
        },
      }),
    },
  });
}

/**
 * Clears `lastSelectedOrganizationId` when it points at a workspace the user
 * no longer belongs to, so their next request cannot land there.
 *
 * Uses raw SQL so `updatedAt` is not bumped; a no-op when the column already
 * points elsewhere. Best-effort and outside any transaction: a failure is
 * logged, never thrown, so it cannot undo a committed revocation.
 *
 * @param args.userId - The member who lost access
 * @param args.organizationId - The workspace they lost
 */
export async function clearLastSelectedOrganization({
  userId,
  organizationId,
}: {
  userId: User["id"];
  organizationId: Organization["id"];
}) {
  try {
    await db.$executeRaw`
      UPDATE "User"
      SET "lastSelectedOrganizationId" = NULL
      WHERE "id" = ${userId}
        AND "lastSelectedOrganizationId" = ${organizationId}
    `;
  } catch (cleanupError) {
    Logger.warn(
      "Failed to clear lastSelectedOrganizationId during access revocation",
      userId,
      organizationId,
      cleanupError
    );
  }
}

/**
 * Removes a member from a workspace: deletes the membership, disconnects every
 * linked team member, then clears `lastSelectedOrganizationId` when it points
 * at this workspace.
 *
 * @param args.userId - The member losing access
 * @param args.organizationId - The workspace
 * @param args.actorOwnsWorkspace - `access.ownsWorkspace` of the member doing
 *   the revoking; undefined for system callers (see {@link revokeMembershipInTx})
 * @returns The updated user row
 * @throws {ShelfError} 400 when the member owns the workspace; 403 when the
 *   actor may not revoke this member
 */
export async function revokeAccessToOrganization({
  userId,
  organizationId,
  actorOwnsWorkspace,
}: {
  userId: User["id"];
  organizationId: Organization["id"];
  actorOwnsWorkspace?: boolean;
}) {
  try {
    /**
     * Read first purely so the common case gets an actionable message before a
     * transaction opens. {@link revokeMembershipInTx} re-reads the membership
     * under its lock and is what enforces the rule; this read can go stale.
     */
    const targetUserOrg = await db.userOrganization.findFirst({
      where: { userId, organizationId },
      select: { roles: true },
    });

    if (isWorkspaceOwner(targetUserOrg?.roles)) {
      throw new ShelfError({
        cause: null,
        title: "Cannot revoke the owner's access",
        message:
          "This user owns the workspace. Transfer ownership to someone else first, then revoke their access.",
        additionalData: { userId, organizationId },
        label,
        status: 400,
        shouldBeCaptured: false,
      });
    }

    const result = await db.$transaction((tx) =>
      revokeMembershipInTx(tx, { userId, organizationId, actorOwnsWorkspace })
    );

    await clearLastSelectedOrganization({ userId, organizationId });

    return result;
  } catch (cause) {
    // Preserve our own errors: the owner guard (400) and the owner-only rule
    // (403) are messages the user needs to read, and rewrapping would turn
    // them into a generic captured 500.
    if (isLikeShelfError(cause)) {
      throw cause;
    }

    throw new ShelfError({
      cause,
      message: "Failed to revoke user access to organization",
      additionalData: { userId, organizationId },
      label,
    });
  }
}

/**
 * Changes a member's role in an organization in place. Does NOT move entities:
 * the caller runs {@link transferOnRoleChange} in the same transaction, after
 * this call, so a refused change takes no entity row locks.
 *
 * Call after {@link lockMembership} in the same transaction: the refusals below
 * read the membership, and only the lock makes that read the one the write
 * applies to.
 *
 * Refuses, before writing:
 * - assigning a role that owns the workspace (ownership moves only through
 *   `transferOwnership`);
 * - changing a member who owns the workspace (OWNER anywhere in the
 *   membership). This refusal also keeps what a role change moves correct:
 *   an owner stepping down to Administrator would keep the bookings they
 *   created for others, so an owner must never reach a role change;
 * - granting a role, or changing a member whose effective role, needs the
 *   workspace owner (`membership.changeRequiresOwner`) when the actor is a
 *   member who is not the owner.
 *
 * @param args.userId - The member whose role changes
 * @param args.organizationId - The workspace
 * @param args.newRole - The single role they will hold
 * @param args.actorOwnsWorkspace - `access.ownsWorkspace` of the acting member,
 *   or `null` when no member acts: an SSO login applying the member's IdP
 *   groups, which is not bound by the owner-only rules. Required, so every
 *   caller states which it is.
 * @param args.tx - The role-change transaction holding the membership lock
 * @returns The updated membership plus the member's previous effective role
 * @throws {ShelfError} 400 when assigning a workspace-owning role, 403 when the
 *   member owns the workspace or an owner-only rule applies, or when the
 *   member is not in the workspace
 */
export async function changeUserRole({
  userId,
  organizationId,
  newRole,
  actorOwnsWorkspace,
  tx: client,
}: {
  userId: User["id"];
  organizationId: Organization["id"];
  newRole: OrganizationRoles;
  actorOwnsWorkspace: boolean | null;
  tx: Omit<ExtendedPrismaClient, ITXClientDenyList>;
}) {
  try {
    if (ROLE_POLICIES[newRole].membership.ownsWorkspace) {
      throw new ShelfError({
        cause: null,
        message:
          "Cannot assign Owner role directly. Use ownership transfer instead.",
        label,
        status: 400,
        shouldBeCaptured: false,
      });
    }

    const userOrg = await client.userOrganization.findFirst({
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
        status: 404,
        shouldBeCaptured: false,
      });
    }

    const currentRole = resolveRole(userOrg.roles);

    if (isWorkspaceOwner(userOrg.roles)) {
      throw new ShelfError({
        cause: null,
        message:
          "Cannot change the Owner's role. Use ownership transfer instead.",
        label,
        status: 403,
        shouldBeCaptured: false,
      });
    }

    if (
      actorOwnsWorkspace !== null &&
      !canAssignRole({ actorOwnsWorkspace, role: newRole })
    ) {
      throw new ShelfError({
        cause: null,
        title: "Insufficient permissions",
        message: `Only the workspace owner can promote users to ${ROLE_LABELS[newRole]}.`,
        label,
        status: 403,
        shouldBeCaptured: false,
      });
    }

    if (actorOwnsWorkspace === false && roleChangeRequiresOwner(currentRole)) {
      throw new ShelfError({
        cause: null,
        title: "Insufficient permissions",
        message: `Only the workspace owner can change an ${ROLE_LABELS[currentRole]}'s role.`,
        label,
        status: 403,
        shouldBeCaptured: false,
      });
    }

    const updated = await client.userOrganization.update({
      where: {
        userId_organizationId: {
          userId,
          organizationId,
        },
      },
      data: {
        roles: { set: [newRole] },
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

/**
 * Prisma `where` selecting the bookings a DEMOTION reassigns to the new owner:
 * those the user created for a DIFFERENT registered custodian. Shared by
 * {@link transferEntitiesToNewOwner} (which moves them) and the change-role
 * dialog's entity-count endpoint (which tells the admin how many will move), so
 * the number the admin consents to and the rows actually reassigned cannot drift.
 *
 * The custodian filter is `IS NOT NULL AND <> userId`, written explicitly rather
 * than as the terser `{ not: userId }`: a null `custodianUserId` marks the
 * booking as the user's own — an unassigned draft, or a legacy row held via the
 * team-member link — which must stay theirs. `{ not: userId }` alone excludes
 * nulls only because this Prisma version compiles `not` to a bare `<>`; the
 * explicit `not: null` keeps those rows out regardless of that behaviour. See
 * the JSDoc on {@link transferEntitiesToNewOwner} for the full rationale.
 */
export function bookingsReassignedOnDemotionWhere({
  userId,
  organizationId,
}: {
  userId: User["id"];
  organizationId: Organization["id"];
}): Prisma.BookingWhereInput {
  return {
    creatorId: userId,
    organizationId,
    AND: [
      { custodianUserId: { not: null } },
      { custodianUserId: { not: userId } },
    ],
  };
}

/**
 * Moves a user's entities inside an organization to another user.
 *
 * OWNERSHIP, moved on removal, and on a role change when `moves.ownership`:
 * `Asset`/`Category`/`Tag`/`Location`/`CustomField`/`Image.userId`,
 * `Kit`/`AssetReminder.createdById`.
 *
 * AUTHORSHIP + ASSIGNMENT:
 * - `removal`: `Invite.inviterId` and `Booking.creatorId` transfer to the new
 *   owner, and `Booking.custodianUserId` is nulled. A departing user must come
 *   off every FK before their row is anonymized (`Booking.creator`/`custodianUser`
 *   are `onDelete: Cascade`; `creatorId` is non-nullable, so it transfers rather
 *   than nulls).
 * - `demotion`: the user keeps membership, so `Invite.inviterId` stays theirs
 *   and `Booking.custodianUserId` is left untouched. When
 *   `moves.bookingsCreatedForOthers`, `Booking.creatorId` transfers ONLY for
 *   bookings whose custodian is a DIFFERENT registered user, the bookings the
 *   user created on someone else's behalf. Their own bookings keep
 *   `creatorId`: either they are the custodian, or there is no registered
 *   custodian (an unassigned draft, or a legacy row held via the team-member
 *   link with a null `custodianUserId`).
 *
 * Why scope demotion that way: `validateBookingOwnership` grants
 * SELF_SERVICE/BASE access on `creatorId === userId || custodianUserId === userId`.
 * Transferring ALL of a demoted user's `creatorId` would hide their own drafts
 * from them (DRAFT visibility keys solely on `creatorId`) and leak those drafts
 * to the recipient; keeping ALL of it would let them retain write access to
 * bookings they created for other people. Moving only the created-for-others
 * slice avoids both.
 *
 * Narrow, accepted residue on `demotion`: a booking created for a NON-registered
 * member (null `custodianUserId`, custody on the team-member link only) keeps
 * the demoted user as creator, since there is no registered custodian to hand
 * it to.
 *
 * Notes (Note, BookingNote, LocationNote) are intentionally NOT transferred:
 * their userId represents authorship, not ownership.
 *
 * Required to be used inside a transaction.
 *
 * @param args.tx - The surrounding transaction
 * @param args.id - The user whose entities move
 * @param args.newOwnerId - Who receives them
 * @param args.organizationId - The workspace
 * @param args.reason - Why the entities move, required with no default because
 *   the two callers need opposite booking rewrites: `removal` (the user loses
 *   access), or `demotion` (the user keeps membership and their role changes)
 *   with `moves`, what the role change moves (see `roleChangeTransfers`)
 */
export async function transferEntitiesToNewOwner(
  args: {
    tx: Omit<ExtendedPrismaClient, ITXClientDenyList>;
    id: User["id"];
    newOwnerId: User["id"];
    organizationId: Organization["id"];
  } & (
    | { reason: "removal" }
    | { reason: "demotion"; moves: RoleChangeTransfers }
  )
) {
  const { tx, id, newOwnerId, organizationId } = args;
  // A departing member hands over everything they own; a role change hands
  // over ownership only when the ownership tier drops.
  const moveOwnership = args.reason === "removal" || args.moves.ownership;

  if (moveOwnership) {
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
  }

  /**
   * AUTHORSHIP + ASSIGNMENT rewrites, removal only. On a role change the user
   * keeps membership, so inviterId (authorship) stays theirs, and the
   * Booking.creator/custodianUser cascade-defusing rewrites below don't apply
   * (see the accepted-consequence note in the JSDoc above).
   */
  if (args.reason === "removal") {
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
  }

  if (args.reason === "demotion" && args.moves.bookingsCreatedForOthers) {
    /**
     * Hand over ONLY the bookings the user created for a different registered
     * custodian; their own bookings keep `creatorId`. The predicate (and the
     * reason it is null-safe) lives in {@link bookingsReassignedOnDemotionWhere},
     * shared with the count the change-role dialog shows the admin.
     */
    await tx.booking.updateMany({
      where: bookingsReassignedOnDemotionWhere({
        userId: id,
        organizationId,
      }),
      data: {
        creatorId: newOwnerId,
      },
    });
  }

  if (moveOwnership) {
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

    /** Update asset reminders */
    await tx.assetReminder.updateMany({
      where: {
        createdById: id,
        organizationId: organizationId,
      },
      data: {
        createdById: newOwnerId,
      },
    });
  }
}

/**
 * Refuses a transfer recipient a role change may not use. Runs inside the
 * role-change transaction, before any entity write; a refusal rolls the whole
 * change back, so roles, entities and the role-change log stay untouched.
 *
 * The recipient's membership is read without a lock, on purpose. A concurrent
 * demotion or removal of the recipient can commit between this check and the
 * entity writes, leaving the entities with a member who may no longer receive
 * them; they stay in the workspace and the owner can reassign them. Locking the
 * recipient's row (FOR SHARE) would let two cross role changes deadlock each
 * other, which costs more than that narrow window.
 *
 * @param args.tx - The role-change transaction
 * @param args.recipientId - Who would receive the member's entities
 * @param args.targetUserId - The member whose role changes
 * @param args.organizationId - The workspace
 * @throws {ShelfError} 400 when the recipient is the target, not a member, or
 *   holds no role whose policy may receive transfers
 */
export async function assertTransferRecipient({
  tx,
  recipientId,
  targetUserId,
  organizationId,
}: {
  tx: Omit<ExtendedPrismaClient, ITXClientDenyList>;
  recipientId: User["id"];
  targetUserId: User["id"];
  organizationId: Organization["id"];
}): Promise<void> {
  const refuse = (message: string) =>
    new ShelfError({
      cause: null,
      title: "Invalid transfer recipient",
      message,
      additionalData: { recipientId, targetUserId, organizationId },
      label,
      status: 400,
      shouldBeCaptured: false,
    });

  if (recipientId === targetUserId) {
    throw refuse(
      "The member whose role is changing cannot receive their own items."
    );
  }

  const recipient = await tx.userOrganization.findUnique({
    where: { userId_organizationId: { userId: recipientId, organizationId } },
    select: { roles: true },
  });

  if (!recipient) {
    throw refuse("Transfer recipient is not a member of this organization");
  }

  if (
    !holdsRoleWhere(recipient.roles, (p) => p.membership.canReceiveTransfers)
  ) {
    const eligible = rolesWhere((p) => p.membership.canReceiveTransfers)
      .map((role) => ROLE_LABELS[role])
      .join(" or ");
    throw refuse(`Transfer recipient must be an ${eligible}.`);
  }
}

/**
 * Moves a member's entities for a role change, when the change moves any:
 * ownership columns when the ownership tier drops, bookings created for other
 * registered custodians when writing every booking becomes writing their own.
 * Bookings whose custodian is a non-registered member (null `custodianUserId`)
 * stay with the member.
 *
 * Every role-change path calls this inside its transaction, after taking the
 * membership lock ({@link lockMembership}) and authorizing the change.
 *
 * @param args.tx - The role-change transaction
 * @param args.targetUserId - The member whose role changes
 * @param args.organizationId - The workspace
 * @param args.fromRoles - Every role the member holds now, read under the lock
 * @param args.toRole - The single role they will hold
 * @param args.recipientId - Who receives what moves
 * @returns What moved (both `false` when nothing did; then no read or write
 *   happens)
 * @throws {ShelfError} 400 from {@link assertTransferRecipient}
 */
export async function transferOnRoleChange({
  tx,
  targetUserId,
  organizationId,
  fromRoles,
  toRole,
  recipientId,
}: {
  tx: Omit<ExtendedPrismaClient, ITXClientDenyList>;
  targetUserId: User["id"];
  organizationId: Organization["id"];
  fromRoles: OrganizationRoles[];
  toRole: OrganizationRoles;
  recipientId: User["id"];
}): Promise<RoleChangeTransfers> {
  const moves = roleChangeTransfers({ fromRoles, to: toRole });
  if (!moves.ownership && !moves.bookingsCreatedForOthers) return moves;

  await assertTransferRecipient({
    tx,
    recipientId,
    targetUserId,
    organizationId,
  });
  await transferEntitiesToNewOwner({
    tx,
    id: targetUserId,
    newOwnerId: recipientId,
    organizationId,
    reason: "demotion",
    moves,
  });
  return moves;
}

/**
 * Loads the user shown on a team profile page, with only what the page
 * renders. Memberships are limited to workspaces the VIEWER also belongs to
 * (used to offer a workspace switch when the user is not in the current one);
 * invites are limited to the current workspace and to their status.
 *
 * @param args.id - The viewed user
 * @param args.organizationId - The viewer's current workspace
 * @param args.userOrganizations - The viewer's memberships
 * @param args.request - For the switch-workspace redirect
 * @returns The profile fields
 * @throws {ShelfError} 404 when the user is not in the workspace (with the
 *   viewer's other workspaces that do contain them, for the switch prompt)
 */
export async function getUserProfileForOrg({
  id,
  organizationId,
  userOrganizations,
  request,
}: {
  id: User["id"];
  organizationId: Organization["id"];
  userOrganizations?: Pick<UserOrganization, "organizationId">[];
  request?: Request;
}) {
  const viewerOrgIds = [
    organizationId,
    ...(userOrganizations?.map((o) => o.organizationId) ?? []),
  ];
  const uniqueViewerOrgIds = [...new Set(viewerOrgIds)];
  try {
    const user = await db.user.findFirstOrThrow({
      where: {
        id,
        userOrganizations: {
          some: { organizationId: { in: uniqueViewerOrgIds } },
        },
      },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        displayName: true,
        profilePicture: true,
        sso: true,
        userOrganizations: {
          where: { organizationId: { in: uniqueViewerOrgIds } },
          select: { organizationId: true, roles: true },
        },
        teamMembers: {
          where: { organizationId },
          select: {
            id: true,
            receivedInvites: {
              where: { organizationId },
              select: { status: true },
            },
          },
        },
      },
    });

    const isUserInCurrentOrg = user.userOrganizations.some(
      (uo) => uo.organizationId === organizationId
    );
    if (!isUserInCurrentOrg) {
      /* The user is in another of the viewer's workspaces: offer a switch. */
      throw new ShelfError({
        cause: null,
        title: "User not found",
        message: "",
        additionalData: {
          model: "teamMember",
          organizations:
            userOrganizations?.filter((org) =>
              user.userOrganizations.some(
                (uo) => uo.organizationId === org.organizationId
              )
            ) ?? [],
          redirectTo: request ? getRedirectUrlFromRequest(request) : undefined,
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
