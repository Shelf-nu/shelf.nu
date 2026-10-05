/**
 * SSO Enforcement
 *
 * Decides whether an email address may use a legacy (non-SSO) sign-in path:
 * password login, email OTP and password reset. It is the single decision every
 * legacy entry point asks, so the web forms, the companion app and existing web
 * sessions all refuse the same accounts.
 *
 * The decision is per-account, so its answer describes the account behind an
 * address. Only act on it visibly after the caller has authenticated as that
 * account (the password or code was accepted, or a session exists), or where
 * the caller already holds a secret tied to the address (an invite token).
 * Before authentication a response may depend only on the address's DOMAIN,
 * which the SSO login page already reveals: refuse silently (send nothing,
 * answer as a success) and use `isSsoDomainEmail` for any hint. A refusal shown
 * to an anonymous caller tells them whether an address is a converted account
 * or an SSO domain's password owner.
 *
 * The rules, in order:
 *   1. With SSO disabled for the deployment, everything is allowed.
 *   2. An account converted to SSO (`User.sso`) is refused on any domain.
 *   3. A domain not configured for SSO is allowed.
 *   4. On an SSO domain, an address with no account is refused (signup is
 *      already blocked there).
 *   5. An unconverted account is allowed while the domain does not enforce
 *      SSO login. A domain enforces it only when at least one linked workspace
 *      (one whose SSO settings list the domain) has SSO enabled
 *      (`Organization.enabledSso`) and "Require SSO login"
 *      (`SsoDetails.requireSsoLogin`) switched on. Registering a domain with
 *      the identity provider is therefore never enough on its own: until a
 *      workspace with SSO enabled claims it, its accounts keep their password.
 *      Shelf staff switch "Require SSO login" off while a customer sets up and
 *      tests SSO with a few users; one enforcing workspace keeps the block for
 *      the whole domain.
 *   6. An unconverted owner of a workspace linked to that SSO domain is
 *      allowed, so the customer keeps a password owner as the administrative
 *      fallback. Owning any other workspace grants nothing: anyone can create
 *      a workspace of their own.
 *   7. Everyone else on an enforcing domain is refused.
 *
 * The cheapest checks run first: the owner queries only run for a non-SSO user
 * on a domain that enforces SSO login, and only over its linked workspaces.
 *
 * The user is looked up here with its own query rather than `findUserByEmail`,
 * because `~/modules/user/service.server` imports `~/modules/auth/service.server`,
 * which calls into this module.
 *
 * `~/modules/auth/service.server` imports this module, which imports
 * `~/utils/sso.server`, which imports `~/modules/auth/sso-conversion.server`,
 * which imports `~/modules/auth/service.server` again. The cycle is safe because
 * none of these modules calls into another at import time, only inside function
 * bodies: do not add top-level calls to any of them.
 *
 * @see {@link file://./service.server.ts} the legacy sign-in paths that ask this
 * @see {@link file://./sso-conversion.server.ts} account conversion, which uses `userOwnsLinkedSsoWorkspace`
 * @see {@link file://./../../utils/sso.server.ts} checkDomainSSOStatus
 */
import { OrganizationRoles } from "@prisma/client";
import { db } from "~/database/db.server";
import {
  caseInsensitiveEmailFilter,
  normalizeInviteEmail,
} from "~/modules/invite/helpers";
import { DISABLE_SSO } from "~/utils/env";
import { ShelfError } from "~/utils/error";
import { checkDomainSSOStatus } from "~/utils/sso.server";

/**
 * Why a legacy sign-in was refused.
 *
 * - `sso_account`: the account itself has been converted to SSO.
 * - `sso_domain`: the address is on a domain configured for SSO, and either
 *   has no account, or the domain enforces SSO login and the account is not
 *   an unconverted owner of the domain's SSO workspace.
 */
export type LegacyLoginRefusalReason = "sso_account" | "sso_domain";

/** The outcome of `getLegacyLoginDecision`. */
export type LegacyLoginDecision =
  | { allowed: true }
  | { allowed: false; reason: LegacyLoginRefusalReason };

/**
 * Returns true when the user owns one of the given workspaces, either as the
 * `Organization.owner` (userId) or through an `OWNER` role on its membership.
 *
 * Pass the workspaces linked to the user's SSO domain
 * (`checkDomainSSOStatus(email).linkedOrganizations`). Ownership of any other
 * workspace must never count: anyone on an SSO domain can create a workspace
 * of their own, so it cannot be what exempts them from SSO.
 *
 * @param userId - the Shelf `User.id` to check
 * @param organizationIds - the workspaces linked to the user's SSO domain
 * @returns `true` when the user owns one of them; `false` without a query when
 *   the list is empty
 */
export async function userOwnsLinkedSsoWorkspace(
  userId: string,
  organizationIds: string[]
): Promise<boolean> {
  if (organizationIds.length === 0) return false;

  const ownedOrgs = await db.organization.count({
    where: { userId, id: { in: organizationIds } },
  });
  if (ownedOrgs > 0) return true;

  const ownerMembership = await db.userOrganization.count({
    where: {
      userId,
      roles: { has: OrganizationRoles.OWNER },
      organizationId: { in: organizationIds },
    },
  });
  return ownerMembership > 0;
}

/**
 * Finds the account an email address resolves to, whatever case it was stored
 * in. Mirrors `pickUserForEmail` in `~/modules/user/service.server`: the row
 * stored in lowercase wins, otherwise the oldest, so the same address always
 * resolves to the same account.
 *
 * @param email - the address as the person typed it
 * @returns the account's id and SSO flag, or null when there is none
 */
async function findAccountForEmail(
  email: string
): Promise<{ id: string; email: string; sso: boolean } | null> {
  const users = await db.user.findMany({
    where: { email: caseInsensitiveEmailFilter(email) },
    select: { id: true, email: true, sso: true },
    orderBy: { createdAt: "asc" },
  });

  return (
    users.find((user) => user.email === normalizeInviteEmail(email)) ??
    users[0] ??
    null
  );
}

/** The fields of a linked workspace that decide whether it enforces SSO. */
type SsoEnforcingWorkspace = {
  enabledSso: boolean;
  ssoDetails: { requireSsoLogin: boolean } | null;
};

/**
 * Whether a domain enforces SSO-only login: at least one of its linked
 * workspaces has SSO enabled and "Require SSO login" switched on. A domain
 * with no linked workspace, or whose linked workspaces do not have SSO
 * enabled yet, enforces nothing. A missing `ssoDetails` counts as the switch
 * being on, matching the column default.
 *
 * @param linkedOrganizations - the domain's linked workspaces, as
 *   `checkDomainSSOStatus` returns them
 * @param options.ignoreSwitch - treat "Require SSO login" as on everywhere.
 *   For checks that must not follow a temporary relaxation.
 * @returns true when unconverted non-owners on the domain must use SSO
 */
export function isSsoLoginEnforced(
  linkedOrganizations: SsoEnforcingWorkspace[],
  { ignoreSwitch = false }: { ignoreSwitch?: boolean } = {}
): boolean {
  return linkedOrganizations.some(
    (org) =>
      org.enabledSso &&
      (ignoreSwitch || org.ssoDetails?.requireSsoLogin !== false)
  );
}

/**
 * Applies the rules in the file header to one account (or none) and the
 * address whose domain is checked.
 *
 * @param email - the address whose domain decides rules 3 to 7
 * @param user - the account behind the address, or null when there is none
 * @returns the decision
 */
async function decideLegacyLogin(
  email: string,
  user: { id: string; sso: boolean } | null,
  {
    honourRelaxation = true,
  }: {
    /**
     * Whether the "Require SSO login" switch may allow the account. Off for
     * the email-change guard: the switch relaxes logins during an SSO pilot,
     * and moving the address off the domain would escape enforcement for good
     * once the switch is back on.
     */
    honourRelaxation?: boolean;
  } = {}
): Promise<LegacyLoginDecision> {
  // A converted account has no password or email identity left, whatever its
  // domain, so it is refused before the domain is even looked up.
  if (user?.sso) return { allowed: false, reason: "sso_account" };

  const { isConfiguredForSSO, linkedOrganizations } =
    await checkDomainSSOStatus(email);
  if (!isConfiguredForSSO) return { allowed: true };

  if (!user) return { allowed: false, reason: "sso_domain" };

  if (
    !isSsoLoginEnforced(linkedOrganizations, {
      ignoreSwitch: !honourRelaxation,
    })
  ) {
    return { allowed: true };
  }

  const linkedOrgIds = linkedOrganizations.map((org) => org.id);
  if (await userOwnsLinkedSsoWorkspace(user.id, linkedOrgIds)) {
    return { allowed: true };
  }

  return { allowed: false, reason: "sso_domain" };
}

/**
 * Decides whether an email address may sign in through a legacy path
 * (password, email OTP, password reset). See the file header for the rules.
 *
 * For callers that know only an address (before authentication). A caller
 * holding the authenticated user's id uses `getLegacyLoginDecisionForUser`,
 * which cannot resolve to a different account that shares the address in
 * another letter case.
 *
 * @param email - the address the person is signing in with
 * @returns `{ allowed: true }`, or `{ allowed: false, reason }` when the
 *   address must use SSO
 * @throws {ShelfError} If a lookup fails
 */
export async function getLegacyLoginDecision(
  email: string
): Promise<LegacyLoginDecision> {
  if (DISABLE_SSO) return { allowed: true };

  return decideLegacyLogin(email, await findAccountForEmail(email));
}

/**
 * The same decision as `getLegacyLoginDecision`, for a caller that already
 * knows which account is signed in: the account is loaded by id, so it is
 * exactly the authenticated one. The domain rules read `email`.
 *
 * @param args.userId - the Shelf `User.id` of the authenticated account
 * @param args.email - the account's address: the session's authenticated
 *   address, or the account's stored email when the caller loaded it
 * @returns `{ allowed: true }`, or `{ allowed: false, reason }` when the
 *   account must use SSO
 * @throws {ShelfError} If a lookup fails
 */
export async function getLegacyLoginDecisionForUser({
  userId,
  email,
}: {
  userId: string;
  email: string;
}): Promise<LegacyLoginDecision> {
  if (DISABLE_SSO) return { allowed: true };

  const user = await db.user.findUnique({
    where: { id: userId },
    select: { id: true, sso: true },
  });

  return decideLegacyLogin(email, user);
}

/** The message a refused email change shows the person. */
export const SSO_EMAIL_CHANGE_REFUSED_MESSAGE =
  "Your account signs in with single sign-on; ask your administrator to change your email.";

/**
 * Refuses a self-service email change for a standard account that the legacy
 * decision refuses. Changing the address to one on a domain without SSO would
 * otherwise turn the account back into one that may sign in with a password.
 *
 * Accounts converted to SSO are not checked here: their sign-in no longer
 * depends on the address.
 *
 * @param args.userId - the Shelf `User.id` of the signed-in account
 * @param args.email - the session's current authenticated address
 * @throws {ShelfError} 403 when the account must use SSO; any lookup failure
 */
export async function assertEmailChangeAllowed({
  userId,
  email,
}: {
  userId: string;
  email: string;
}): Promise<void> {
  if (DISABLE_SSO) return;

  const user = await db.user.findUnique({
    where: { id: userId },
    select: { id: true, sso: true },
  });
  if (user?.sso) return;

  const decision = await decideLegacyLogin(email, user, {
    honourRelaxation: false,
  });
  if (decision.allowed) return;

  throw new ShelfError({
    cause: null,
    status: 403,
    title: "Single sign-on required",
    message: SSO_EMAIL_CHANGE_REFUSED_MESSAGE,
    label: "Auth",
    shouldBeCaptured: false,
    additionalData: { userId, reason: decision.reason },
  });
}

/** The message every refused legacy sign-in shows the person. */
export const SSO_REQUIRED_MESSAGE =
  "This email address signs in with single sign-on. Please use Login with SSO.";

/**
 * Builds the error a refused address is shown once it has authenticated (or
 * holds an invite token), so the web forms, the invite page and the companion
 * app all say the same thing. Never throw it before authentication: see the
 * file header.
 *
 * @param reason - why the decision refused the address
 * @returns a 403 `ShelfError`, not captured: a refusal is expected, not a fault
 */
export function createSsoRequiredError(
  reason: LegacyLoginRefusalReason
): ShelfError {
  return new ShelfError({
    cause: null,
    status: 403,
    title: "Single sign-on required",
    message: SSO_REQUIRED_MESSAGE,
    label: "Auth",
    shouldBeCaptured: false,
    additionalData: { reason },
  });
}

/**
 * Whether an address is on a domain configured for SSO, for the domain-level
 * "use Login with SSO" hint shown before authentication. The answer is the same
 * for every address on the domain, so it is safe to show to anyone.
 *
 * @param email - the address the person typed
 * @returns `true` when SSO is enabled for the deployment and the domain is
 *   configured for it
 * @throws {ShelfError} If the domain lookup fails
 */
export async function isSsoDomainEmail(email: string): Promise<boolean> {
  if (DISABLE_SSO) return false;

  const { isConfiguredForSSO } = await checkDomainSSOStatus(email);
  return isConfiguredForSSO;
}
