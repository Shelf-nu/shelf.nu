/**
 * SSO Enforcement
 *
 * Decides whether an email address may use a legacy (non-SSO) sign-in path:
 * password login, email OTP and password reset. It is the single decision every
 * legacy entry point asks, so the web forms, the companion app and existing web
 * sessions all refuse the same accounts.
 *
 * The rules, in order:
 *   1. With SSO disabled for the deployment, everything is allowed.
 *   2. An account converted to SSO (`User.sso`) is refused on any domain.
 *   3. A domain not configured for SSO is allowed.
 *   4. On an SSO domain, an address with no account is refused (signup is
 *      already blocked there).
 *   5. A workspace owner who has not been converted is allowed, so every SSO
 *      customer keeps a password owner as the administrative fallback.
 *   6. Everyone else on an SSO domain is refused.
 *
 * The cheapest checks run first: the owner queries only run for a non-SSO user
 * on an SSO domain.
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
 * @see {@link file://./service.server.ts} the legacy sign-in paths that assert this
 * @see {@link file://./sso-conversion.server.ts} account conversion, which uses `userOwnsTeamOrg`
 * @see {@link file://./../../utils/sso.server.ts} checkDomainSSOStatus
 */
import { OrganizationRoles, OrganizationType } from "@prisma/client";
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
 * - `sso_domain`: the address is on a domain configured for SSO, and the
 *   account is not an unconverted workspace owner (or does not exist).
 */
export type LegacyLoginRefusalReason = "sso_account" | "sso_domain";

/** The outcome of `getLegacyLoginDecision`. */
export type LegacyLoginDecision =
  | { allowed: true }
  | { allowed: false; reason: LegacyLoginRefusalReason };

/**
 * Returns true when the user owns at least one TEAM organization, either as the
 * `Organization.owner` (userId) or through an `OWNER` role on a TEAM
 * membership. Personal workspaces do not count: every user owns one.
 *
 * @param userId - the Shelf `User.id` to check
 * @returns `true` when the user owns a TEAM workspace
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

/**
 * Decides whether an email address may sign in through a legacy path
 * (password, email OTP, password reset). See the file header for the rules.
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

  const user = await findAccountForEmail(email);

  // A converted account has no password or email identity left, whatever its
  // domain, so it is refused before the domain is even looked up.
  if (user?.sso) return { allowed: false, reason: "sso_account" };

  const { isConfiguredForSSO } = await checkDomainSSOStatus(email);
  if (!isConfiguredForSSO) return { allowed: true };

  if (!user) return { allowed: false, reason: "sso_domain" };

  if (await userOwnsTeamOrg(user.id)) return { allowed: true };

  return { allowed: false, reason: "sso_domain" };
}

/** The message every refused legacy sign-in shows the person. */
export const SSO_REQUIRED_MESSAGE =
  "This email address signs in with single sign-on. Please use Login with SSO.";

/**
 * Builds the error every legacy entry point throws for a refused address, so
 * the web forms, the invite page and the companion app all say the same thing.
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
 * Throws when an email address must sign in with SSO instead of a legacy path.
 * Call it before handing the address to Supabase for password login, OTP or a
 * password reset.
 *
 * @param email - the address the person is signing in with
 * @throws {ShelfError} 403, not captured, when the address must use SSO
 */
export async function assertLegacyLoginAllowed(email: string): Promise<void> {
  const decision = await getLegacyLoginDecision(email);
  if (decision.allowed) return;

  throw createSsoRequiredError(decision.reason);
}
