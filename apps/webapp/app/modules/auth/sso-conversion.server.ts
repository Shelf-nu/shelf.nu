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
 * `provider = 'sso:<providerId>'` and `provider_id` is the SAML subject.
 * Conversion pre-seeds that row with the user's email as the subject. Supabase
 * links the first SSO login to that email-keyed identity (same SSO provider,
 * same email) whatever NameID the IdP sends, so it lands on the original UUID.
 *
 * The exception is a user who tried SSO before conversion: that attempt was
 * refused but left a duplicate SSO auth user (same email, no Shelf `User`)
 * holding the IdP identity, and the first SSO login after conversion lands on
 * it. `reconcileDuplicateSsoLogin` merges it back onto the original account
 * from the SSO callback, and the user's next SSO sign-in lands on the original.
 * The admin page flags these accounts (`hasEarlierSsoLogin`,
 * `needsExtraSignIn`) so staff can tell the user to expect that extra sign-in.
 *
 * Owners of a workspace linked to the domain (one whose SSO settings list it)
 * may be converted one at a time, but `convertAllEligibleOnDomain` skips them:
 * an unconverted owner of the customer's SSO workspace keeps password login,
 * which is the customer's administrative fallback when their IdP is
 * unavailable. Owning any other workspace earns no such treatment, because
 * anyone on the domain can create one.
 * `revertAccountToStandard` turns a converted account back into an email
 * account for that same recovery case.
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
import { OrganizationRoles } from "@prisma/client";
import type { AuthSession } from "@server/session";
import { db } from "~/database/db.server";
import { getAuthUserById } from "~/modules/auth/service.server";
import { userOwnsLinkedSsoWorkspace } from "~/modules/auth/sso-enforcement.server";
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
  /**
   * `skipped_owner` is returned only when the caller asked to skip owners of
   * the domain's SSO workspace (Convert all) and the account is one.
   */
  status: "converted" | "skipped_already_sso" | "skipped_owner";
  /**
   * True when a converted user tried SSO before conversion, so their first SSO
   * sign-in merges that attempt and asks them to sign in once more. Always
   * false for `skipped_already_sso`.
   */
  needsExtraSignIn: boolean;
};

/** A candidate row for the admin conversion UI. */
export type SsoConversionCandidate = {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  displayName: string | null;
  /** Owns a workspace linked to the domain's SSO (Convert all skips them). */
  ownsSsoWorkspace: boolean;
  alreadySso: boolean;
  /**
   * Another SSO auth user holds this email: the user tried SSO before their
   * account was converted. Only meaningful while `alreadySso` is false.
   */
  hasEarlierSsoLogin: boolean;
};

/** One account that `convertAllEligibleOnDomain` could not convert. */
export type SsoConvertAllFailure = {
  userId: string;
  email: string;
  message: string;
};

/** Summary of a Convert all run: how many accounts converted, and which failed. */
export type SsoConvertAllResult = {
  converted: number;
  /** Converted accounts whose first SSO sign-in will ask them to sign in again. */
  needsExtraSignIn: number;
  /** Accounts that owned the domain's SSO workspace by the time their turn came. */
  skippedOwners: number;
  failed: SsoConvertAllFailure[];
};

/** Result of reverting a converted account to a standard email account. */
export type SsoRevertResult = {
  userId: string;
  email: string;
  status: "reverted";
};

/**
 * The unique index on `auth.users.email` that only covers non-SSO users. A
 * revert that trips it means another standard account already holds the
 * address.
 */
const AUTH_USERS_EMAIL_UNIQUE_CONSTRAINT = "users_email_partial_key";

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
 * Finds which of the given accounts tried SSO before being converted: another
 * auth user exists with the same email (case-insensitive) and
 * `is_sso_user = true`. That is the duplicate a refused pre-conversion SSO
 * sign-in leaves behind, which the first SSO sign-in after conversion lands on.
 *
 * One query for the whole list; none when the list is empty. An account's own
 * auth row never counts, even once it is SSO itself.
 *
 * @param accounts - the Shelf users (`id` is also the auth user id) to check
 * @returns the lowercased emails that have such an earlier SSO auth user
 */
async function findEmailsWithEarlierSsoLogin(
  accounts: { id: string; email: string }[]
): Promise<Set<string>> {
  if (accounts.length === 0) return new Set();

  const emails = accounts.map((a) => a.email.toLowerCase());
  const ids = accounts.map((a) => a.id);

  const rows = await db.$queryRaw<{ email: string }[]>`
    SELECT DISTINCT lower(email) AS email
    FROM auth.users
    WHERE is_sso_user = true
      AND lower(email) = ANY(${emails}::text[])
      AND id::text <> ALL(${ids}::text[])
  `;

  return new Set(rows.map((row) => row.email));
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
 * Guards: skips users already SSO (idempotent); requires the domain to have a
 * configured SSO provider; requires the auth account to exist. Owners of the
 * domain's SSO workspace are converted like anyone else; a converted owner
 * loses the password login an unconverted one keeps, and support can undo it
 * with `revertAccountToStandard`.
 *
 * The seeded `provider_id` is the lowercased email. An SSO auth user left by a
 * sign-in attempted before conversion is merged by `reconcileDuplicateSsoLogin`
 * at callback time, which costs the user one extra sign-in; `needsExtraSignIn`
 * reports it.
 *
 * @param args.userId - the Shelf `User.id` (same as the auth UUID) to convert
 * @param args.actorUserId - the admin performing the conversion, for the log
 * @returns the conversion result: `converted` or `skipped_already_sso`, and
 *   whether the user's first SSO sign-in will ask them to sign in again
 * @throws {ShelfError} on any guard failure
 */
export async function convertAccountToSso({
  userId,
  actorUserId,
  skipSsoWorkspaceOwner = false,
}: {
  userId: string;
  actorUserId?: string;
  /**
   * Leave the account alone when it owns a workspace linked to its SSO
   * domain. Convert all sets this so an owner keeps their password fallback
   * even when they became an owner after the run listed its candidates.
   */
  skipSsoWorkspaceOwner?: boolean;
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
        needsExtraSignIn: false,
      };
    }

    if (skipSsoWorkspaceOwner) {
      // Checked per account at conversion time, not from the candidate list,
      // so an ownership change during a Convert all run is respected.
      const { linkedOrganizations } = await checkDomainSSOStatus(user.email);
      const ownsSsoWorkspace = await userOwnsLinkedSsoWorkspace(
        user.id,
        linkedOrganizations.map((org) => org.id)
      );
      if (ownsSsoWorkspace) {
        return {
          userId: user.id,
          email: user.email,
          status: "skipped_owner",
          needsExtraSignIn: false,
        };
      }
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

    const needsExtraSignIn = (await findEmailsWithEarlierSsoLogin([user])).has(
      subject
    );

    await db.$transaction(async (tx) => {
      // ON CONFLICT keeps a re-run idempotent, and leaves an identity already
      // held by an earlier SSO auth user to the callback's reconcile.
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

    return {
      userId: user.id,
      email: user.email,
      status: "converted",
      needsExtraSignIn,
    };
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
 * The active session belongs to the deleted duplicate, so the caller must not
 * issue it. It asks the user to sign in again instead (see
 * `resolveUserAndOrgForSsoCallback`); that sign-in matches the moved identity.
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
 * whether they already use SSO, whether they own a workspace linked to the
 * domain's SSO (which Convert all skips), and whether they tried SSO before
 * conversion. Ownership of any other workspace is not reported: it does not
 * exempt anyone from SSO.
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

  // `checkDomainSSOStatus` reads the domain from an address.
  const { linkedOrganizations } = await checkDomainSSOStatus(`@${normalized}`);
  const linkedOrgIds = linkedOrganizations.map((org) => org.id);

  const earlierSsoEmails = await findEmailsWithEarlierSsoLogin(users);

  // Same two ownership shapes as `userOwnsLinkedSsoWorkspace`, batched for the
  // whole list and scoped to the domain's linked workspaces.
  const ownerIds = new Set<string>();
  if (linkedOrgIds.length > 0) {
    const [ownedOrgs, ownerMemberships] = await Promise.all([
      db.organization.findMany({
        where: { userId: { in: userIds }, id: { in: linkedOrgIds } },
        select: { userId: true },
      }),
      db.userOrganization.findMany({
        where: {
          userId: { in: userIds },
          roles: { has: OrganizationRoles.OWNER },
          organizationId: { in: linkedOrgIds },
        },
        select: { userId: true },
      }),
    ]);
    for (const { userId } of [...ownedOrgs, ...ownerMemberships]) {
      ownerIds.add(userId);
    }
  }

  return users.map((u) => ({
    id: u.id,
    email: u.email,
    firstName: u.firstName,
    lastName: u.lastName,
    displayName: u.displayName,
    alreadySso: u.sso,
    ownsSsoWorkspace: ownerIds.has(u.id),
    hasEarlierSsoLogin: earlierSsoEmails.has(u.email.toLowerCase()),
  }));
}

/**
 * Converts every eligible account on a domain, one after another, each in its
 * own transaction. Eligible means not already SSO and not an owner of a
 * workspace linked to the domain, recomputed here from the database rather
 * than taken from the client, so the admin page cannot widen the set. Those
 * owners are left on password login and can be converted individually with
 * `convertAccountToSso`. Owners of any other workspace are converted.
 *
 * One account failing does not stop the rest: its error is collected and the
 * run continues.
 *
 * @param args.domain - the email domain to convert (case and surrounding
 *   whitespace are ignored)
 * @param args.actorUserId - the admin performing the conversion, for the log
 * @returns how many accounts converted, how many of those will be asked to sign
 *   in again at their first SSO sign-in, and the accounts that failed with
 *   their messages
 * @throws {ShelfError} 400 when the domain has no configured SSO provider,
 *   raised once before any account is touched
 */
export async function convertAllEligibleOnDomain({
  domain,
  actorUserId,
}: {
  domain: string;
  actorUserId?: string;
}): Promise<SsoConvertAllResult> {
  const normalized = domain.trim().toLowerCase();

  // `checkDomainSSOStatus` reads the domain from an address.
  await requireSsoProviderIdForEmail(`@${normalized}`);

  const candidates = await findEligibleAccountsForSsoConversion(normalized);
  const eligible = candidates.filter(
    (c) => !c.alreadySso && !c.ownsSsoWorkspace
  );

  const result: SsoConvertAllResult = {
    converted: 0,
    needsExtraSignIn: 0,
    skippedOwners: 0,
    failed: [],
  };

  for (const candidate of eligible) {
    try {
      const { status, needsExtraSignIn } = await convertAccountToSso({
        userId: candidate.id,
        actorUserId,
        skipSsoWorkspaceOwner: true,
      });
      if (status === "converted") {
        result.converted += 1;
        if (needsExtraSignIn) result.needsExtraSignIn += 1;
      } else if (status === "skipped_owner") {
        result.skippedOwners += 1;
      }
    } catch (cause) {
      result.failed.push({
        userId: candidate.id,
        email: candidate.email,
        message:
          cause instanceof Error ? cause.message : "Failed to convert account.",
      });
    }
  }

  Logger.info(
    `SSO conversion: convert all on ${normalized} by ${
      actorUserId ?? "unknown"
    }: ${eligible.length} eligible, ${result.converted} converted, ${
      result.skippedOwners
    } skipped as owners, ${result.failed.length} failed`
  );

  return result;
}

/**
 * Returns true when `cause`, or anything in its cause chain, is the unique
 * violation on `auth.users.email` for non-SSO users. Prisma reports raw-query
 * failures as `P2010`, which covers every raw error, so this matches the
 * constraint name in the message instead.
 *
 * @param cause - any thrown value
 */
function isStandardEmailTakenError(cause: unknown): boolean {
  const visited = new Set<object>();
  let current = cause;
  while (typeof current === "object" && current !== null) {
    if (visited.has(current)) return false;
    visited.add(current);
    const error = current as {
      message?: unknown;
      meta?: { message?: unknown };
      cause?: unknown;
    };
    if (
      (typeof error.message === "string" &&
        error.message.includes(AUTH_USERS_EMAIL_UNIQUE_CONSTRAINT)) ||
      (typeof error.meta?.message === "string" &&
        error.meta.message.includes(AUTH_USERS_EMAIL_UNIQUE_CONSTRAINT))
    ) {
      return true;
    }
    current = error.cause;
  }
  return false;
}

/**
 * Support recovery tool: turns a converted SSO account back into a standard
 * email account, keeping its UUID. Meant for a customer whose IdP is
 * unavailable. Afterwards the account has no password; the user sets one
 * through Forgot password.
 *
 * Only allowed when the reverted account could then use password login, per
 * the same rules as `getLegacyLoginDecision`: the account owns a workspace
 * linked to its SSO domain, or its domain is no longer configured for SSO.
 * Anyone else on an SSO domain (including the owner of some other workspace)
 * would be reverted into an account that cannot sign in at all.
 *
 * In one transaction it removes the account's SSO identities, adds an `email`
 * identity, clears `is_sso_user` and points the app metadata at the email
 * provider (the password stays empty), signs out every session, and clears
 * `User.sso`.
 *
 * @param args.userId - the Shelf `User.id` (same as the auth UUID) to revert
 * @param args.actorUserId - the admin performing the revert, for the log
 * @returns the reverted account
 * @throws {ShelfError} 404 when the user does not exist, 400 when it is not an
 *   SSO account or could not use password login after the revert, 409 when
 *   another standard account already uses the email address
 */
export async function revertAccountToStandard({
  userId,
  actorUserId,
}: {
  userId: string;
  actorUserId?: string;
}): Promise<SsoRevertResult> {
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

    if (!user.sso) {
      throw new ShelfError({
        cause: null,
        message: "This account is not an SSO account.",
        additionalData: { userId, email: user.email },
        label,
        status: 400,
        shouldBeCaptured: false,
      });
    }

    // The domain check runs first: the owner queries are only needed when the
    // domain still uses SSO.
    const { isConfiguredForSSO, linkedOrganizations } =
      await checkDomainSSOStatus(user.email);
    const canUsePasswordLogin =
      !isConfiguredForSSO ||
      (await userOwnsLinkedSsoWorkspace(
        user.id,
        linkedOrganizations.map((org) => org.id)
      ));

    if (!canUsePasswordLogin) {
      throw new ShelfError({
        cause: null,
        message:
          "Only an owner of the workspace that uses SSO for this domain, or an account whose domain no longer uses SSO, can be reverted. Anyone else on an SSO domain still could not sign in with a password.",
        additionalData: { userId, email: user.email },
        label,
        status: 400,
        shouldBeCaptured: false,
      });
    }

    const email = user.email.toLowerCase();

    await db.$transaction(async (tx) => {
      await tx.$executeRaw`
        DELETE FROM auth.identities
        WHERE user_id = ${user.id}::uuid
          AND provider LIKE 'sso:%'
      `;

      // An email identity's provider_id is the user id. ON CONFLICT keeps a
      // re-run idempotent.
      await tx.$executeRaw`
        INSERT INTO auth.identities
          (user_id, provider_id, provider, identity_data, last_sign_in_at, created_at, updated_at)
        VALUES (
          ${user.id}::uuid,
          ${user.id}::text,
          'email',
          jsonb_build_object(
            'sub', ${user.id}::text,
            'email', ${email}::text,
            'email_verified', true,
            'phone_verified', false
          ),
          now(), now(), now()
        )
        ON CONFLICT (provider_id, provider) DO NOTHING
      `;

      // `||` merges into the existing jsonb without dropping other keys. The
      // password stays NULL until the user sets one.
      await tx.$executeRaw`
        UPDATE auth.users
        SET
          is_sso_user = false,
          raw_app_meta_data = COALESCE(raw_app_meta_data, '{}'::jsonb)
            || jsonb_build_object(
                 'provider', 'email',
                 'providers', jsonb_build_array('email')
               )
        WHERE id = ${user.id}::uuid
      `;

      await tx.$executeRaw`
        DELETE FROM auth.sessions
        WHERE user_id = ${user.id}::uuid
      `;

      await tx.user.update({
        where: { id: user.id },
        data: { sso: false },
      });
    });

    Logger.info(
      `SSO conversion: reverted user ${user.id} (${
        user.email
      }) to a standard account, performed by ${actorUserId ?? "unknown"}`
    );

    return { userId: user.id, email: user.email, status: "reverted" };
  } catch (cause) {
    if (isStandardEmailTakenError(cause)) {
      throw new ShelfError({
        cause,
        message:
          "Another standard account already uses this email address. Resolve that account before reverting.",
        additionalData: { userId, actorUserId },
        label,
        status: 409,
        shouldBeCaptured: true,
      });
    }

    throw new ShelfError({
      cause,
      message:
        cause instanceof ShelfError
          ? cause.message
          : "Failed to revert account to a standard account.",
      additionalData: { userId, actorUserId },
      label,
      shouldBeCaptured:
        cause instanceof ShelfError ? cause.shouldBeCaptured : true,
    });
  }
}
