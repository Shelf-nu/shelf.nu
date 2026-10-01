/**
 * SSO Account Conversion
 *
 * Converts standard (email/password) Shelf accounts into SSO-only accounts
 * without changing the user's UUID, so everything that references `User.id`
 * (assets, bookings, memberships, activity events, user links inside notes)
 * stays intact.
 *
 * Supabase Auth never links an SSO login to a non-SSO account on its own. The
 * only way it matches an SSO assertion to an existing user is through a row in
 * `auth.identities` keyed on `UNIQUE(provider_id, provider)`, where
 * `provider = 'sso:<providerId>'` and `provider_id` is the SAML subject. For
 * Shelf's documented IdPs the subject is the user's email (see
 * apps/docs/sso/providers/*). Conversion therefore pre-seeds that identity row
 * on the existing auth user, so the first SSO login lands on the original UUID.
 *
 * When the subject does not match the pre-seeded value (a different NameID
 * format, or a login that happened before conversion), Supabase creates a
 * duplicate SSO auth user. `reconcileDuplicateSsoLogin` merges it back onto the
 * original account from the SSO callback.
 *
 * All writes are DML on the `auth` schema inside a Prisma transaction: no
 * schema change is involved.
 *
 * `requireSsoProviderIdForEmail` imports `checkDomainSSOStatus` from
 * `~/utils/sso.server`, which in turn imports `reconcileDuplicateSsoLogin` from
 * this module. The cycle is safe because neither module calls into the other at
 * import time, only inside function bodies.
 *
 * @see {@link file://./../../utils/sso.server.ts} resolveUserAndOrgForSsoCallback
 * @see {@link file://./../../routes/_layout+/admin-dashboard+/sso-conversion.tsx}
 */
import { OrganizationRoles, OrganizationType } from "@prisma/client";
import type { AuthSession } from "@server/session";
import { db } from "~/database/db.server";
import { getAuthUserById } from "~/modules/auth/service.server";
import { USER_NAME_SELECT } from "~/modules/user/fields";
import { ShelfError } from "~/utils/error";
import { Logger } from "~/utils/logger";
import { checkDomainSSOStatus } from "~/utils/sso.server";

const label = "SSO" as const;

/**
 * The transaction client handed to a `db.$transaction(async (tx) => ...)`
 * callback. Derived from the project's extended Prisma client rather than the
 * generated `Prisma.TransactionClient`, because the two are not assignable to
 * each other once the client is extended.
 */
type SsoConversionTx = Parameters<Parameters<typeof db.$transaction>[0]>[0];

/** Result of a single account conversion attempt. */
export type SsoConversionResult = {
  userId: string;
  email: string;
  status: "converted" | "skipped_already_sso";
};

/** A candidate row for the admin conversion UI. */
export type SsoConversionCandidate = {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  displayName: string | null;
  ownsTeamOrg: boolean;
  alreadySso: boolean;
};

/**
 * Returns true when the user owns at least one TEAM organization, either as the
 * `Organization.owner` (userId) or through an `OWNER` role on a TEAM
 * membership. Owners stay non-SSO as the administrative fallback, so they are
 * never eligible for conversion.
 *
 * @param userId - the Shelf `User.id` to check
 * @returns `true` when the user owns a TEAM org and is therefore ineligible
 */
export async function userOwnsTeamOrg(userId: string): Promise<boolean> {
  const ownedTeamOrgs = await db.organization.count({
    where: { userId, type: OrganizationType.TEAM },
  });
  if (ownedTeamOrgs > 0) return true;

  const ownerMembership = await db.userOrganization.count({
    where: {
      userId,
      roles: { has: OrganizationRoles.OWNER },
      organization: { type: OrganizationType.TEAM },
    },
  });
  return ownerMembership > 0;
}

/**
 * Raw-SQL core shared by both conversion paths. Given the auth user id that
 * should become SSO-only, it:
 *   1. Sets `is_sso_user = true`, clears the password, and rewrites
 *      `raw_app_meta_data.provider`/`providers` to the SSO provider.
 *   2. Deletes the user's `email` identity so password login is gone.
 *   3. Deletes the user's sessions (refresh tokens cascade). The web auth
 *      boundary is the refresh-token row, so this forces the next request
 *      through SSO.
 *
 * Idempotent. Must run inside a Prisma interactive transaction (`tx`).
 *
 * @param tx - active Prisma transaction client
 * @param originalUserId - the auth.users.id to seal as SSO-only
 * @param ssoProviderId - the auth.sso_providers.id (the `<id>` in `sso:<id>`)
 */
async function sealAuthUserAsSso(
  tx: SsoConversionTx,
  originalUserId: string,
  ssoProviderId: string
): Promise<void> {
  const provider = `sso:${ssoProviderId}`;

  // `||` merges into the existing jsonb without dropping other keys.
  await tx.$executeRaw`
    UPDATE auth.users
    SET
      is_sso_user = true,
      encrypted_password = NULL,
      raw_app_meta_data = COALESCE(raw_app_meta_data, '{}'::jsonb)
        || jsonb_build_object(
             'provider', ${provider}::text,
             'providers', jsonb_build_array(${provider}::text)
           )
    WHERE id = ${originalUserId}::uuid
  `;

  await tx.$executeRaw`
    DELETE FROM auth.identities
    WHERE user_id = ${originalUserId}::uuid
      AND provider = 'email'
  `;

  await tx.$executeRaw`
    DELETE FROM auth.sessions
    WHERE user_id = ${originalUserId}::uuid
  `;
}

/**
 * Resolves the SSO provider id configured for an email's domain, or throws.
 *
 * @param email - the email whose domain provider should be resolved
 * @returns the configured `auth.sso_providers.id` for the domain
 * @throws {ShelfError} when the domain has no configured SSO provider
 */
async function requireSsoProviderIdForEmail(email: string): Promise<string> {
  const status = await checkDomainSSOStatus(email);
  if (!status.isConfiguredForSSO || !status.ssoProviderId) {
    throw new ShelfError({
      cause: null,
      message:
        "This email domain is not configured for SSO. Configure the SSO provider for the domain before converting accounts.",
      additionalData: { email },
      label,
      status: 400,
      shouldBeCaptured: false,
    });
  }
  return status.ssoProviderId;
}

/**
 * Admin-initiated conversion. Attaches an SSO identity to the user's existing
 * auth account so their next SSO login lands on the original UUID, then seals
 * the account as SSO-only and signs out its current sessions.
 *
 * Guards: skips users already SSO (idempotent); refuses workspace owners;
 * requires the domain to have a configured SSO provider; requires the auth
 * account to exist.
 *
 * The seeded `provider_id` is the lowercased email. Stored email case is not
 * normalized, and an IdP that sends a different case is handled by
 * `reconcileDuplicateSsoLogin` at callback time.
 *
 * @param args.userId - the Shelf `User.id` (same as the auth UUID) to convert
 * @param args.actorUserId - the admin performing the conversion, for the log
 * @returns the conversion result (`converted` or `skipped_already_sso`)
 * @throws {ShelfError} on any guard failure
 */
export async function convertAccountToSso({
  userId,
  actorUserId,
}: {
  userId: string;
  actorUserId?: string;
}): Promise<SsoConversionResult> {
  try {
    const user = await db.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, sso: true },
    });

    if (!user) {
      throw new ShelfError({
        cause: null,
        message: "User not found.",
        additionalData: { userId },
        label,
        status: 404,
        shouldBeCaptured: false,
      });
    }

    if (user.sso) {
      return {
        userId: user.id,
        email: user.email,
        status: "skipped_already_sso",
      };
    }

    if (await userOwnsTeamOrg(user.id)) {
      throw new ShelfError({
        cause: null,
        message:
          "This user owns a team workspace and cannot be converted to SSO. A workspace owner must remain a non-SSO account.",
        additionalData: { userId, email: user.email },
        label,
        status: 400,
        shouldBeCaptured: false,
      });
    }

    const ssoProviderId = await requireSsoProviderIdForEmail(user.email);
    const provider = `sso:${ssoProviderId}`;
    const subject = user.email.toLowerCase();

    const authUser = await getAuthUserById(user.id);
    if (!authUser) {
      throw new ShelfError({
        cause: null,
        message: "No auth account found for this user.",
        additionalData: { userId, email: user.email },
        label,
      });
    }

    await db.$transaction(async (tx) => {
      // ON CONFLICT keeps a re-run idempotent.
      await tx.$executeRaw`
        INSERT INTO auth.identities
          (user_id, provider_id, provider, identity_data, last_sign_in_at, created_at, updated_at)
        VALUES (
          ${user.id}::uuid,
          ${subject},
          ${provider},
          jsonb_build_object(
            'sub', ${subject}::text,
            'email', ${subject}::text,
            'email_verified', true
          ),
          now(), now(), now()
        )
        ON CONFLICT (provider_id, provider) DO NOTHING
      `;

      await sealAuthUserAsSso(tx, user.id, ssoProviderId);

      await tx.user.update({
        where: { id: user.id },
        data: { sso: true, onboarded: true },
      });
    });

    Logger.info(
      `SSO conversion: converted user ${user.id} (${
        user.email
      }) to SSO provider ${ssoProviderId}, performed by ${
        actorUserId ?? "unknown"
      }`
    );

    return { userId: user.id, email: user.email, status: "converted" };
  } catch (cause) {
    throw new ShelfError({
      cause,
      message:
        cause instanceof ShelfError
          ? cause.message
          : "Failed to convert account to SSO.",
      additionalData: { userId, actorUserId },
      label,
      shouldBeCaptured:
        cause instanceof ShelfError ? cause.shouldBeCaptured : true,
    });
  }
}

/**
 * Callback safety net. Called when a user signed in through SSO and Supabase
 * created a duplicate auth user because no matching pre-seeded identity
 * existed. Moves the duplicate's SSO identity onto the original account, seals
 * the original as SSO-only, and deletes the duplicate auth user.
 *
 * It can only ever delete an SSO auth user that is not the original: the
 * delete is guarded on `is_sso_user = true AND id <> original`, and the whole
 * transaction rolls back unless exactly one identity moved and exactly one
 * auth user was deleted.
 *
 * The caller must then ask the user to sign in again: the active session
 * belongs to the deleted duplicate.
 *
 * @param args.authSession - the session issued for the duplicate auth user
 * @param args.existingUser - the original Shelf user matched by email (sso === true)
 * @throws {ShelfError} when the duplicate is the original account, the domain
 *   has no SSO provider, or the identity move / duplicate delete did not affect
 *   exactly one row
 */
export async function reconcileDuplicateSsoLogin({
  authSession,
  existingUser,
}: {
  authSession: AuthSession;
  existingUser: { id: string; email: string; sso: boolean };
}): Promise<void> {
  const duplicateUserId = authSession.userId;

  if (duplicateUserId === existingUser.id) {
    throw new ShelfError({
      cause: null,
      message:
        "Cannot reconcile an SSO login onto the same account it came from.",
      additionalData: { userId: existingUser.id },
      label,
      status: 500,
      shouldBeCaptured: true,
    });
  }

  const ssoProviderId = await requireSsoProviderIdForEmail(existingUser.email);
  const provider = `sso:${ssoProviderId}`;

  await db.$transaction(async (tx) => {
    // Once the identity belongs to the original user, deleting the duplicate
    // below no longer cascades it away (identities are ON DELETE CASCADE).
    const movedIdentities = await tx.$executeRaw`
      UPDATE auth.identities
      SET user_id = ${existingUser.id}::uuid
      WHERE user_id = ${duplicateUserId}::uuid
        AND provider = ${provider}
    `;

    if (movedIdentities !== 1) {
      throw new ShelfError({
        cause: null,
        message:
          "Could not move the SSO identity onto the existing account. Please contact support.",
        additionalData: {
          userId: existingUser.id,
          duplicateUserId,
          ssoProviderId,
          movedIdentities,
        },
        label,
        status: 500,
        shouldBeCaptured: true,
      });
    }

    await sealAuthUserAsSso(tx, existingUser.id, ssoProviderId);

    const deletedUsers = await tx.$executeRaw`
      DELETE FROM auth.users
      WHERE id = ${duplicateUserId}::uuid
        AND is_sso_user = true
        AND id <> ${existingUser.id}::uuid
    `;

    if (deletedUsers !== 1) {
      throw new ShelfError({
        cause: null,
        message:
          "Could not remove the duplicate SSO account. Please contact support.",
        additionalData: {
          userId: existingUser.id,
          duplicateUserId,
          ssoProviderId,
          deletedUsers,
        },
        label,
        status: 500,
        shouldBeCaptured: true,
      });
    }

    await tx.user.update({
      where: { id: existingUser.id },
      data: { sso: true, onboarded: true },
    });
  });

  Logger.info(
    `SSO conversion: reconciled duplicate auth user ${duplicateUserId} onto user ${existingUser.id} (${existingUser.email}) for SSO provider ${ssoProviderId}`
  );
}

/**
 * Lists candidate accounts for the admin conversion UI: every non-deleted Shelf
 * user whose email domain matches `domain` (case-insensitive), annotated with
 * whether they already use SSO and whether they own a team org (and are
 * therefore ineligible).
 *
 * @param domain - the email domain to match (e.g. "acme.com")
 * @returns the matching accounts with eligibility annotations, ordered by email
 */
export async function findEligibleAccountsForSsoConversion(
  domain: string
): Promise<SsoConversionCandidate[]> {
  const normalized = domain.trim().toLowerCase();
  const users = await db.user.findMany({
    where: {
      deletedAt: null,
      email: { endsWith: `@${normalized}`, mode: "insensitive" },
    },
    select: {
      id: true,
      email: true,
      ...USER_NAME_SELECT,
      sso: true,
    },
    orderBy: { email: "asc" },
  });

  if (users.length === 0) return [];

  const userIds = users.map((u) => u.id);

  // Same two ownership shapes as `userOwnsTeamOrg`, batched for the whole list.
  const [ownedTeamOrgs, ownerMemberships] = await Promise.all([
    db.organization.findMany({
      where: { userId: { in: userIds }, type: OrganizationType.TEAM },
      select: { userId: true },
    }),
    db.userOrganization.findMany({
      where: {
        userId: { in: userIds },
        roles: { has: OrganizationRoles.OWNER },
        organization: { type: OrganizationType.TEAM },
      },
      select: { userId: true },
    }),
  ]);

  const ownerIds = new Set<string>([
    ...ownedTeamOrgs.map((o) => o.userId),
    ...ownerMemberships.map((m) => m.userId),
  ]);

  return users.map((u) => ({
    id: u.id,
    email: u.email,
    firstName: u.firstName,
    lastName: u.lastName,
    displayName: u.displayName,
    alreadySso: u.sso,
    ownsTeamOrg: ownerIds.has(u.id),
  }));
}
