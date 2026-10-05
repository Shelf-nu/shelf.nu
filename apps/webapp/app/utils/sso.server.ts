import type { Organization, SsoDetails } from "@prisma/client";
import { isAuthApiError } from "@supabase/supabase-js";
import type { AuthSession } from "@server/session";
import { db } from "~/database/db.server";
import {
  deleteAuthAccount,
  getAuthUserById,
  type refreshAccessToken,
  revokeSession,
} from "~/modules/auth/service.server";
import { reconcileDuplicateSsoLogin } from "~/modules/auth/sso-conversion.server";
import { caseInsensitiveEmailFilter } from "~/modules/invite/helpers";
import { USER_WITH_SSO_DETAILS_SELECT } from "~/modules/user/fields";
import {
  createUserFromSSO,
  updateUserFromSSO,
} from "~/modules/user/service.server";
import type { DetectedFormatPrefs } from "./date-format";
import { DISABLE_SSO } from "./env";
import { isLikeShelfError, ShelfError } from "./error";
import { emailMatchesDomains, isValidDomain, parseDomains } from "./misc";

/**
 * Finds the Shelf account an SSO login belongs to by email, whatever case the
 * address was stored in. Stored emails are not normalized, while the IdP and
 * Supabase may send a different case, so an exact match would miss the account
 * and send the login down the new-user path.
 *
 * The match feeds the SCIM re-key and the duplicate reconcile, both of which
 * rewrite accounts, so it must name exactly one user: two accounts whose
 * emails differ only in case are refused rather than guessed between.
 *
 * @param email - the email Supabase returned for the SSO login
 * @returns the matching user, or null when no account has the address
 * @throws {ShelfError} 409 when more than one account matches
 */
async function findSsoCallbackUserByEmail(email: string) {
  const matches = await db.user.findMany({
    where: { email: caseInsensitiveEmailFilter(email) },
    select: USER_WITH_SSO_DETAILS_SELECT,
    take: 2,
  });

  if (matches.length > 1) {
    throw new ShelfError({
      cause: null,
      status: 409,
      title: "Account needs attention",
      message:
        "More than one Shelf account uses this email address. Please contact our support team so we can sign you in to the right one.",
      // The email stays out of the logs: the ids identify the accounts
      // without carrying personal data.
      additionalData: { userIds: matches.map((m) => m.id) },
      label: "Auth",
    });
  }

  return matches[0] ?? null;
}

/**
 * Looks up a Shelf user's Supabase auth user, reading a genuine 404 as "no auth
 * account" (a SCIM-provisioned user has none yet). Any other failure is
 * rethrown so a transient Supabase error is never mistaken for a missing user,
 * which would send the callback down the destructive id re-key.
 *
 * @param userId - the Shelf user id, which is also the auth user id when one exists
 * @returns the auth user, or null when Supabase answers 404
 * @throws {ShelfError} for any failure other than a 404
 */
async function findAuthUserOrNull(userId: string) {
  try {
    return await getAuthUserById(userId);
  } catch (error) {
    const innerCause = isLikeShelfError(error) ? error.cause : error;
    if (isAuthApiError(innerCause) && innerCause.status === 404) {
      return null;
    }
    throw error;
  }
}

/**
 * Refuses an SSO callback that matched a Shelf account by email unless the
 * authenticated auth user holds an identity from the SSO provider registered
 * for the session email's domain (`provider = 'sso:<id>'`, the same binding
 * the account conversion seeds and the claims reader trusts).
 *
 * Every email-matched branch rewrites or updates an account the session does
 * not own by id (the SCIM re-key, the duplicate merge, the profile update), so
 * the email alone must not decide it: an identity from another provider can
 * carry any email the IdP behind it chooses to assert. One query covers both
 * the domain's provider and the identity.
 *
 * @param authSession - the session just refreshed and checked as SAML
 * @param matchedUserId - the Shelf account matched by email, for the log
 * @throws {ShelfError} 403 when the session holds no identity from the
 *   domain's provider, or the domain has none
 */
async function assertSessionHoldsDomainProviderIdentity(
  authSession: AuthSession,
  matchedUserId: string
): Promise<void> {
  const domain = authSession.email.split("@")[1]?.toLowerCase() ?? "";

  const [binding] = await db.$queryRaw<{ held: boolean }[]>`
    SELECT EXISTS (
      SELECT 1
      FROM auth.identities i
      JOIN auth.sso_domains d
        ON i.provider = 'sso:' || d.sso_provider_id::text
      WHERE i.user_id = ${authSession.userId}::uuid
        AND lower(d.domain) = ${domain}
    ) AS "held"
  `;

  if (binding?.held) return;

  throw new ShelfError({
    cause: null,
    status: 403,
    title: "Single sign-on required",
    message: "Please sign in with your organization's single sign-on.",
    additionalData: { userId: authSession.userId, matchedUserId },
    label: "Auth",
    shouldBeCaptured: true,
  });
}

/**
 * The refusal for an SSO login that lands on an email/password account not
 * approved for SSO. The account stays as it is; support moves it.
 */
function createEmailAccountExistsError() {
  return new ShelfError({
    cause: null,
    title: "Account not on single sign-on yet",
    message:
      "This email already has a Shelf account that has not been moved to single sign-on yet. Ask your Shelf administrator or our support team to convert it: you keep all your data and workspaces, and can then sign in with SSO.",
    label: "Auth",
    shouldBeCaptured: false,
  });
}

/**
 * The `amr` method GoTrue records for a sign-in completed through a SAML IdP.
 * It is carried by every access token refreshed from that session.
 *
 * Only SAML SSO is supported today. Supporting OIDC SSO means accepting its
 * `amr` method here too, or every OIDC sign-in is refused at the callback.
 */
const SSO_SAML_AMR_METHOD = "sso/saml";

/**
 * Reads the authentication methods from an access token's `amr` claim. GoTrue
 * writes either `{ method, timestamp }` entries or bare strings (custom access
 * token hooks), so both are accepted.
 *
 * The signature is not checked: the token comes straight from GoTrue in a
 * server-side refresh, never from the client.
 *
 * @param accessToken - a JWT issued by GoTrue
 * @returns the method names, or an empty list when the token cannot be read
 */
function readAmrMethods(accessToken: string): string[] {
  const [, payloadSegment] = accessToken.split(".");
  if (!payloadSegment) return [];
  try {
    const payload: unknown = JSON.parse(
      Buffer.from(payloadSegment, "base64url").toString("utf8")
    );
    if (
      !payload ||
      typeof payload !== "object" ||
      !("amr" in payload) ||
      !Array.isArray(payload.amr)
    ) {
      return [];
    }
    return payload.amr.flatMap((entry: unknown) => {
      if (typeof entry === "string") return [entry];
      if (
        entry &&
        typeof entry === "object" &&
        "method" in entry &&
        typeof entry.method === "string"
      ) {
        return [entry.method];
      }
      return [];
    });
  } catch {
    return [];
  }
}

/**
 * A session as `refreshAccessToken` returns it. Structurally the same as
 * `AuthSession`; the name states where `assertSsoAuthenticatedSession` expects
 * its input to come from.
 */
type RefreshedAuthSession = Awaited<ReturnType<typeof refreshAccessToken>>;

/**
 * Refuses an SSO callback whose session was not obtained through SSO.
 *
 * The callback routes accept a refresh token posted by the browser, and any
 * Supabase refresh token refreshes into a session, including one from a
 * password or email-code sign-in. Only a session whose access token records a
 * SAML sign-in may provision users or sync roles. A refused session is revoked
 * (scope `local`) before the error is thrown, so the session the refresh just
 * opened does not outlive the request. Call it right after
 * `refreshAccessToken` and before anything else reads the session.
 *
 * SECURITY: pass only a session returned by `refreshAccessToken` in this same
 * request. The check reads the access token's `amr` claim WITHOUT verifying
 * its signature, which is sound only because that token came straight from
 * GoTrue over the server-side refresh. A token taken from a cookie, a header or
 * a form could carry any `amr` its author wrote.
 *
 * @param authSession - the session just refreshed server-side
 * @throws {ShelfError} 403 when the session's `amr` has no SAML entry
 */
export async function assertSsoAuthenticatedSession(
  authSession: RefreshedAuthSession
): Promise<void> {
  if (readAmrMethods(authSession.accessToken).includes(SSO_SAML_AMR_METHOD)) {
    return;
  }
  await revokeSession(authSession.accessToken);
  throw new ShelfError({
    cause: null,
    status: 403,
    title: "Single sign-on required",
    message: "Please sign in with your organization's single sign-on.",
    additionalData: { userId: authSession.userId },
    label: "Auth",
    shouldBeCaptured: false,
  });
}

/**
 * Normalises a stored `groups` claim to a list of group names. A SAML attribute
 * with one value is stored as a bare string, several as an array.
 *
 * @param value - the raw `custom_claims.groups` JSON value
 * @returns the group names; anything unreadable yields none
 */
export function normalizeSsoGroups(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) {
    return value.filter((group): group is string => typeof group === "string");
  }
  return [];
}

/** The contact fields an SSO identity can carry, in Shelf's field names. */
type SsoContactInfo = {
  phone: string;
  street: string;
  city: string;
  stateProvince: string;
  zipPostalCode: string;
  countryRegion: string;
};

/** The profile and role claims an SSO callback acts on. */
export type SsoCallbackClaims = {
  /** From the identity of the domain's own provider only; none otherwise. */
  groups: string[];
  /** Null when no SSO identity of the user carries both names. */
  firstName: string | null;
  lastName: string | null;
  /** Undefined when no SSO identity of the user carries both names. */
  contactInfo?: SsoContactInfo;
};

/**
 * Reads one string claim, trying each key in order (IdPs differ in casing).
 *
 * @param claims - the identity's `custom_claims` object
 * @param keys - the claim names to try
 * @returns the first non-empty string value, or an empty string
 */
function readStringClaim(
  claims: Record<string, unknown>,
  ...keys: string[]
): string {
  for (const key of keys) {
    const value = claims[key];
    if (typeof value === "string" && value.trim() !== "") return value;
  }
  return "";
}

/**
 * Narrows a stored `custom_claims` JSON value to an object.
 *
 * @param value - the raw JSON value
 * @returns the claims object, or an empty one when the value is not an object
 */
function asClaimsObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/**
 * Reads the profile fields from one identity's claims.
 *
 * @param claims - the identity's `custom_claims` object
 * @returns the names and contact info, or null unless both names are present
 */
function readProfileClaims(claims: Record<string, unknown>) {
  const firstName = readStringClaim(claims, "firstname", "firstName");
  const lastName = readStringClaim(claims, "lastname", "lastName");
  if (!firstName || !lastName) return null;
  return {
    firstName,
    lastName,
    contactInfo: {
      phone: readStringClaim(claims, "mobilephone"),
      street: readStringClaim(claims, "streetAddress"),
      city: readStringClaim(claims, "city"),
      stateProvince: readStringClaim(claims, "stateProvince"),
      zipPostalCode: readStringClaim(claims, "postalCode"),
      countryRegion: readStringClaim(claims, "country"),
    },
  };
}

/**
 * Reads the claims an SSO callback acts on from the SSO identities GoTrue wrote
 * out of SAML assertions. They come from here only:
 * - never from request input, which the browser controls;
 * - never from `user_metadata`, which the user can edit through Supabase's
 *   public API.
 *
 * Groups decide workspace roles, so they are read strictly from the identity
 * of the SSO provider registered for the session email's domain
 * (`provider = 'sso:<id>'`), the same binding the account conversion uses. A
 * domain with no registered provider yields no groups. When the user has two
 * identities from that provider (the NameID changed), the one signed in most
 * recently wins.
 *
 * Names and contact info only edit the user's own profile, so they fall back:
 * the bound identity when it carries both names, otherwise the most recently
 * signed-in SSO identity of the user that does. With neither they are absent,
 * and the resolver keeps what the account already has.
 *
 * Identities without `custom_claims` are skipped: one pre-seeded when an
 * account was converted to SSO carries none until the IdP signs it in.
 *
 * @param args.authUserId - the authenticated Supabase auth user id
 * @param args.email - the session's authenticated email; its domain selects
 *   the provider whose groups count
 * @returns the groups, and the names and contact info when any identity has them
 * @throws {ShelfError} when a lookup fails
 */
export async function getSsoClaimsForAuthUser({
  authUserId,
  email,
}: {
  authUserId: string;
  email: string;
}): Promise<SsoCallbackClaims> {
  try {
    const { ssoProviderId } = await checkDomainSSOStatus(email);
    const boundProvider = ssoProviderId ? `sso:${ssoProviderId}` : null;

    // Every SSO identity of the user that carries claims, most recent first.
    // A user has a handful at most, one per IdP subject.
    const rows = await db.$queryRaw<{ provider: string; claims: unknown }[]>`
      SELECT provider, identity_data -> 'custom_claims' AS claims
      FROM auth.identities
      WHERE user_id = ${authUserId}::uuid
        AND provider LIKE 'sso:%'
        AND identity_data -> 'custom_claims' IS NOT NULL
      ORDER BY last_sign_in_at DESC NULLS LAST
    `;

    const boundRow = boundProvider
      ? rows.find((row) => row.provider === boundProvider)
      : undefined;
    const boundClaims = boundRow ? asClaimsObject(boundRow.claims) : null;

    const profile =
      (boundClaims && readProfileClaims(boundClaims)) ??
      rows
        .map((row) => readProfileClaims(asClaimsObject(row.claims)))
        .find((candidate) => candidate !== null) ??
      null;

    return {
      groups: boundClaims ? normalizeSsoGroups(boundClaims.groups) : [],
      firstName: profile?.firstName ?? null,
      lastName: profile?.lastName ?? null,
      contactInfo: profile?.contactInfo,
    };
  } catch (cause) {
    throw new ShelfError({
      cause,
      message: "Failed to read the single sign-on claims for this account",
      additionalData: { authUserId },
      label: "SSO",
    });
  }
}

/**
 * Marks the error raised after a duplicate SSO login was merged onto the
 * original account. The merge succeeded and the next SSO sign-in lands on the
 * original, so the callback routes render this as a success notice, not as a
 * failure. Read it with {@link isSsoAccountLinkedError}.
 */
const SSO_ACCOUNT_LINKED_KEY = "ssoAccountLinked";

/**
 * Whether `cause` is the "account linked, sign in again" outcome of
 * {@link resolveUserAndOrgForSsoCallback}.
 *
 * @param cause - anything caught from the resolver
 * @returns true when the merge succeeded and the user must sign in once more
 */
export function isSsoAccountLinkedError(cause: unknown): cause is ShelfError {
  return (
    isLikeShelfError(cause) &&
    cause.additionalData?.[SSO_ACCOUNT_LINKED_KEY] === true
  );
}

/**
 * This resolves the correct org we should redirect the user to
 * Also it handles:
 * - Creating a new user if the user doesn't exist
 * - Throwing an error if the user is already connected to an email account
 * - Linking the user to the correct org if SCIM is configured
 *
 * Order of checks:
 * 1. A Shelf user whose id is the authenticated auth UUID: a normal login,
 *    including an account converted to SSO whose pre-seeded identity matched.
 *    Update from SSO. An account not approved for SSO (`!user.sso`) whose auth
 *    user is an email/password account is refused instead.
 *
 * Otherwise the Shelf user is matched by email without regard to letter case
 * (see `findSsoCallbackUserByEmail`); no match means a new user. A match is
 * acted on only when the authenticated auth user holds an identity from the
 * SSO provider registered for the email's domain (403 otherwise, touching
 * nothing). For a match:
 * 2. Look up the Shelf user's auth account. Only a genuine 404 counts as
 *    "no auth account"; any other failure is rethrown.
 * 3. No auth account and the ids differ: a SCIM-provisioned placeholder. Re-key
 *    the Shelf user to the SSO auth UUID.
 * 4. Auth account exists, the ids differ and the user is approved for SSO
 *    (`user.sso`): Supabase created a duplicate SSO auth user. Reconcile it onto
 *    the original account via `reconcileDuplicateSsoLogin`, then throw the
 *    account-linked notice (`isSsoAccountLinkedError`) asking the user to sign
 *    in again. The current session belongs to the deleted duplicate, so the
 *    caller must not issue it.
 * 5. Auth account is an email/password account and the user is not approved:
 *    reject and point the user to support.
 * 6. Anything else: update from SSO.
 *
 * Cases to handle:
 * - [x] Auth Account & User exists in our database - we just login the user
 * - [x] Auth Account exists but User doesn't exist in our database - we create a new user connecting it to authUser and login the user
 * - [x] Auth Account(SSO version) doesn't exist but User exists in our database - We show an error as we dont allow SSO users to have an email based identity
 * - [x] Standard account converted to SSO logs in and Supabase links the pre-seeded identity - normal login on the original UUID
 * - [x] Standard account converted to SSO logs in and Supabase creates a duplicate SSO auth user - reconcile onto the original and ask the user to sign in again
 * - [x] Auth account exists but is not present in IDP - an employee gets removed from an app. This is handled by IDP
 * - [x] Auth account DOESN'T exist and is not added to IDP - this is handled by IDP. They give an error if its not authenticated
 * - [x] User tries to reset password for a user that is only SSO
 * - [x] User tries to use normal login for a user that is only SSO - we Dont actually need to check that because SSO users will not have a password they know. As long as we dont allow them to change pwd it should be fine.
 *
 * New cases for Pure SSO:
 * - [x] User signs up with SSO from a domain that has no org configured - should create user with personal workspace only
 * - [x] User signs up with SSO from domain that has org with SCIM - should create user with personal workspace and add to org based on groups
 * - [x] User signs up with SSO from domain that has org without SCIM - should create user with personal workspace only
 * - [x] User with SSO gets invited to a workspace - should be able to accept invite
 * - [x] Existing SSO user's domain gets configured for SCIM - on next login should get org access based on groups
 * - [x] SCIM user loses all group access - should keep personal workspace but lose org access
 *
 * @returns the user and the org to land on
 * @throws {ShelfError} the account-linked notice (see `isSsoAccountLinkedError`)
 *   after a duplicate merge; other ShelfErrors on refusal or failure
 */
export async function resolveUserAndOrgForSsoCallback({
  authSession,
  firstName,
  lastName,
  groups,
  contactInfo,
  formatPrefs,
}: {
  authSession: AuthSession;
  /**
   * Names from {@link getSsoClaimsForAuthUser}; null when no SSO identity
   * carries them. An existing account then keeps its stored names, and a new
   * account is refused.
   */
  firstName: string | null;
  lastName: string | null;
  /** IdP groups from {@link getSsoClaimsForAuthUser}; never request input. */
  groups: string[];
  contactInfo?: {
    phone?: string;
    street?: string;
    city?: string;
    stateProvince?: string;
    zipPostalCode?: string;
    countryRegion?: string;
  };
  /** Browser-detected prefs; only applied on the new-user (createUserFromSSO) branch. */
  formatPrefs?: DetectedFormatPrefs;
}) {
  /**
   * The update for an existing account: the SSO names when the IdP provided
   * them, otherwise the names the account already has, so a missing claim
   * never blanks a stored name.
   */
  const updateDataFor = (existing: {
    firstName: string | null;
    lastName: string | null;
  }) => ({
    firstName: firstName ?? existing.firstName ?? "",
    lastName: lastName ?? existing.lastName ?? "",
    groups,
    contactInfo,
  });

  try {
    // The authenticated auth user's own Shelf account: a normal login. This
    // also covers a converted account, where Supabase matched the pre-seeded
    // SSO identity and signed in the original UUID, whose auth `provider` can
    // still read "email", so the provider is consulted only for an account
    // not approved for SSO.
    // Matching by id first keeps the login working when the IdP's email for
    // the user differs from the one stored in Shelf.
    const ownAccount = await db.user.findUnique({
      where: { id: authSession.userId },
      select: USER_WITH_SSO_DETAILS_SELECT,
    });

    if (ownAccount) {
      // An account not approved for SSO whose auth user signs in by password
      // must not be updated from SSO claims; the callback only accepts SAML
      // sessions, and this holds even if that check is bypassed.
      if (!ownAccount.sso) {
        const ownAuthUser = await findAuthUserOrNull(ownAccount.id);
        if (ownAuthUser?.app_metadata?.provider === "email") {
          throw createEmailAccountExistsError();
        }
      }

      const response = await updateUserFromSSO(
        authSession,
        ownAccount,
        updateDataFor(ownAccount)
      );
      return { user: response.user, org: response.org };
    }

    const user = await findSsoCallbackUserByEmail(authSession.email);

    if (user) {
      // Everything below acts on an account matched by email only, so the
      // session must first prove it came from the domain's own provider.
      await assertSessionHoldsDomainProviderIdentity(authSession, user.id);

      const authUser = await findAuthUserOrNull(user.id);

      // SCIM-provisioned user: Shelf user exists but has no Supabase auth
      // account (user.id is a placeholder cuid). Update the user's ID to
      // match the Supabase SSO auth UUID. FKs use ON UPDATE CASCADE so all
      // related rows update automatically.
      if (!authUser && user.id !== authSession.userId) {
        await db.$executeRawUnsafe(
          `UPDATE "User" SET id = $1 WHERE id = $2`,
          authSession.userId,
          user.id
        );
        // Re-fetch user with updated ID
        const updatedUser = await db.user.findUniqueOrThrow({
          where: { id: authSession.userId },
          select: USER_WITH_SSO_DETAILS_SELECT,
        });
        const response = await updateUserFromSSO(
          authSession,
          updatedUser,
          updateDataFor(updatedUser)
        );
        return { user: response.user, org: response.org };
      }

      // A different auth user authenticated for an account approved for SSO:
      // Supabase created a duplicate SSO auth user because no pre-seeded
      // identity matched. Merge it back onto the original account. Only
      // `user.sso` accounts are merged automatically; un-approved accounts
      // fall through to the support message below.
      if (user.sso) {
        await reconcileDuplicateSsoLogin({
          authSession,
          existingUser: { id: user.id, email: user.email, sso: user.sso },
        });

        // The current session belongs to the duplicate that was just deleted,
        // so it must not be issued. Supabase matches the moved identity on the
        // next SSO sign-in, which lands on the original account. There is no
        // safe admin API to mint a session for an SSO user (a magic link looks
        // up only non-SSO users and would create a new account), so the user
        // signs in once more.
        throw new ShelfError({
          cause: null,
          status: 409,
          title: "Your account is now on single sign-on",
          message:
            "Your account is now on single sign-on. Sign in again to continue.",
          additionalData: { [SSO_ACCOUNT_LINKED_KEY]: true },
          label: "Auth",
          shouldBeCaptured: false,
        });
      }

      if (authUser?.app_metadata?.provider === "email") {
        throw createEmailAccountExistsError();
      }

      // Existing SSO user - update their info
      const response = await updateUserFromSSO(
        authSession,
        user,
        updateDataFor(user)
      );
      return { user: response.user, org: response.org };
    }

    // New user case - create them with SSO. There is no stored name to fall
    // back on, so an IdP that sends none cannot create an account.
    if (!firstName || !lastName) {
      throw new ShelfError({
        cause: null,
        status: 400,
        title: "Missing name",
        message:
          "Your organization's single sign-on did not provide your first and last name. Please contact your workspace administrator.",
        additionalData: { userId: authSession.userId },
        label: "SSO",
        shouldBeCaptured: false,
      });
    }

    try {
      const response = await createUserFromSSO(
        authSession,
        {
          firstName,
          lastName,
          groups,
          contactInfo,
        },
        formatPrefs
      );
      return { user: response.user, org: response.org };
    } catch (createError) {
      // If user creation fails, clean up the auth account
      await deleteAuthAccount(authSession.userId);
      throw createError;
    }
  } catch (cause: any) {
    // The routes recognise this one by its additionalData, which the wrapper
    // below would replace.
    if (isSsoAccountLinkedError(cause)) {
      throw cause;
    }
    throw new ShelfError({
      cause,
      title: cause.title || "Authentication failed",
      message: cause.message || "Failed to authenticate user",
      // The auth user id and domain identify the login for support without
      // writing the address to the server logs.
      additionalData: {
        userId: authSession.userId,
        domain: authSession.email.split("@")[1],
      },
      label: "Auth",
      shouldBeCaptured: isLikeShelfError(cause) ? cause.shouldBeCaptured : true,
    });
  }
}

interface SSODomainConfig {
  id: string;
  ssoProviderId: string;
  domain: string;
}

/**
 * Type for domain check response
 */
interface DomainCheckResult {
  isConfiguredForSSO: boolean;
  /**
   * Every organization that claims the domain. Plural because a domain can
   * legitimately belong to more than one: `SsoDetails.domain` carries no
   * unique constraint, and one `SsoDetails` row is shared by an
   * `Organization[]`. Collapsing this to a single organization picks an
   * arbitrary owner and silently exempts the rest.
   */
  linkedOrganizations: (Organization & { ssoDetails: SsoDetails | null })[];
  ssoProviderId: string | null;
}

/**
 * Fetches all domains configured for SSO in the auth schema
 * Uses raw query to access auth schema tables
 */
export async function getConfiguredSSODomains(): Promise<SSODomainConfig[]> {
  try {
    const domains = await db.$queryRaw<SSODomainConfig[]>`
      SELECT 
        id::text,
        sso_provider_id::text as "ssoProviderId",
        domain
      FROM auth.sso_domains
    `;

    return domains;
  } catch (cause) {
    throw new ShelfError({
      cause,
      message: "Failed to fetch SSO domain configurations",
      label: "SSO",
    });
  }
}

/**
 * Checks a domain's SSO status and which organizations own it.
 *
 * The two halves of the result mean different things and callers act on them
 * differently:
 *
 * - `isConfiguredForSSO` — the domain is federated at the auth layer, so the
 *   user signs in through an IdP rather than a password.
 * - `linkedOrganizations` — the organizations that claim the domain in their
 *   `ssoDetails`, which is what makes each of them **SCIM-managed**:
 *   membership belongs to the IdP, so manual invites into them are refused.
 *
 * A federated domain no organization has claimed is Pure SSO, and invites into
 * it are allowed for users who have already signed in.
 *
 * Callers must test the organization they care about for membership of
 * `linkedOrganizations` rather than reading one element: several organizations
 * can claim the same domain, and answering for only one of them exempts the
 * others from the SCIM rule.
 *
 * @param email - Email whose domain is checked
 * @returns Federation status, every owning organization, and the first SSO
 *   provider configured for the domain
 */
export async function checkDomainSSOStatus(
  email: string
): Promise<DomainCheckResult> {
  try {
    const domain = email.split("@")[1]?.toLowerCase();

    if (!domain) {
      return {
        isConfiguredForSSO: false,
        linkedOrganizations: [],
        ssoProviderId: null,
      };
    }

    // Check all SSO providers configured for this domain
    const ssoConfigs = await db.$queryRaw<{ ssoProviderId: string }[]>`
      SELECT sso_provider_id::text as "ssoProviderId"
      FROM auth.sso_domains
      WHERE lower(domain) = ${domain}
    `;

    if (ssoConfigs.length === 0) {
      return {
        isConfiguredForSSO: false,
        linkedOrganizations: [],
        ssoProviderId: null,
      };
    }

    // Get all SSO provider IDs for this domain
    const ssoProviderIds = ssoConfigs.map((config) => config.ssoProviderId);

    // `ssoDetails.domain` is a comma-separated list, so the database can only
    // narrow it by substring — "notacme.com" comes back for "acme.com". The
    // candidates are therefore a superset, and `emailMatchesDomains` reduces
    // them to the exact owners. Keep ALL of them: reducing to one row here
    // (or before the exact match, where an unrelated substring hit shadows
    // the real owner) reads as Pure SSO for every organization left out.
    const candidateOrgs = await db.organization.findMany({
      where: {
        ssoDetails: {
          domain: {
            contains: domain,
            // Nothing constrains the stored casing — the admin form lowercases
            // what it writes, but that is one write path and no migration
            // normalised what came before. A case-sensitive filter would drop
            // a stored "ACME.com" before the exact match ever sees it, and the
            // organization would read as unclaimed. The auth.sso_domains query
            // above compares through `lower()` for the same reason.
            mode: "insensitive" as const,
          },
        },
      },
      include: {
        ssoDetails: true,
      },
    });

    const linkedOrganizations = candidateOrgs.filter((org) =>
      emailMatchesDomains(domain, org.ssoDetails?.domain ?? null)
    );

    // A domain can have several SSO providers configured; callers that act on
    // one get the first.
    return {
      isConfiguredForSSO: true,
      linkedOrganizations,
      ssoProviderId: ssoProviderIds[0] || null,
    };
  } catch (cause) {
    throw new ShelfError({
      cause,
      message: "Failed to check domain SSO status",
      additionalData: { email },
      label: "SSO",
    });
  }
}

/**
 * Checks if a user with given email exists and uses SSO
 * @param email - Email to check
 */
export async function doesSSOUserExist(email: string): Promise<boolean> {
  try {
    const user = await db.user.findUnique({
      where: { email: email.toLowerCase() },
      select: { sso: true },
    });

    return user?.sso || false;
  } catch (cause) {
    throw new ShelfError({
      cause,
      message: "Failed to check SSO user existence",
      additionalData: { email },
      label: "SSO",
    });
  }
}

/**
 * Validates if signup is allowed for an email based on SSO configuration
 * @throws ShelfError if signup is not allowed due to SSO configuration
 */
export async function validateNonSSOSignup(email: string): Promise<void> {
  /** Quick return if SSO is disabled as this check is then unnecessary */
  if (DISABLE_SSO) return;
  const domainStatus = await checkDomainSSOStatus(email);

  if (domainStatus.isConfiguredForSSO) {
    throw new ShelfError({
      cause: null,
      message:
        "This email domain uses SSO authentication. Please sign in using your organization's SSO provider.",
      label: "Auth",
      status: 400,
      shouldBeCaptured: false,
    });
  }
}

/**
 * Validates multiple comma-separated domains
 * @param domainsString Comma-separated string of domains
 * @returns Array of validated domains
 * @throws Error if any domain is invalid
 */
export function validateDomains(domainsString: string): string[] {
  const domains = parseDomains(domainsString);

  if (domains.length === 0) {
    throw new Error("At least one domain is required");
  }

  // Validate each domain
  const invalidDomains = domains.filter((domain) => !isValidDomain(domain));
  if (invalidDomains.length > 0) {
    throw new Error(`Invalid domain(s): ${invalidDomains.join(", ")}`);
  }

  return domains;
}
