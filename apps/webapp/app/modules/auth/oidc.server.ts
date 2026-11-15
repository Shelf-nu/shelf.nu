/**
 * Custom OIDC Login
 *
 * Signs users in through one custom OAuth/OIDC provider registered in Supabase
 * Auth (`OIDC_PROVIDER`, e.g. `custom:my-idp`). Unlike the domain-based SAML
 * SSO it needs no company domain: the login page shows one button, and the
 * provider's client id, secret and issuer live in Supabase.
 *
 * The flow shares the SSO callback routes:
 * 1. `/oidc-login` redirects to Supabase's authorize endpoint
 *    ({@link getOidcAuthorizeUrl}).
 * 2. Supabase redirects back to `/oauth/callback` (or `/oauth/callback/mobile`)
 *    with the session in the URL fragment, and the page posts the refresh
 *    token.
 * 3. The callback action recognises the session as an OIDC sign-in
 *    ({@link isOidcAuthenticatedSession}), reads the claims from the identity
 *    Supabase stored ({@link getOidcClaimsForAuthUser}) and provisions the
 *    user and their workspace access ({@link resolveUserAndOrgForOidcCallback}).
 *
 * Workspace access comes from `OIDC_WORKSPACE_MAPPINGS`: on every login the
 * user's groups are mapped to a role in each configured workspace, and the
 * membership is granted, changed or revoked to match, exactly as the SAML
 * group mapping does it (`updateUserFromSSO`).
 *
 * @see {@link file://./oidc-workspace-mappings.server.ts}
 * @see {@link file://./sso-callback.server.ts}
 * @see {@link file://./../../routes/_auth+/oidc-login.tsx}
 * @see {@link file://./../../utils/sso.server.ts} the SAML counterpart
 */
import type { Organization } from "@prisma/client";
import { PrismaClientKnownRequestError } from "@prisma/client/runtime/library";
import type { AuthSession } from "@server/session";
import { db } from "~/database/db.server";
import { caseInsensitiveEmailFilter } from "~/modules/invite/helpers";
import { createOrganization } from "~/modules/organization/service.server";
import { USER_WITH_SSO_DETAILS_SELECT } from "~/modules/user/fields";
import type { SsoWorkspaceRole } from "~/modules/user/service.server";
import { createUser, updateUserFromSSO } from "~/modules/user/service.server";
import type { DetectedFormatPrefs } from "~/utils/date-format";
import {
  OIDC_GROUPS_CLAIM,
  OIDC_PROVIDER,
  OIDC_SCOPES,
  SERVER_URL,
  SUPABASE_URL,
} from "~/utils/env";
import { isLikeShelfError, ShelfError } from "~/utils/error";
import type { SsoCallbackClaims } from "~/utils/sso.server";
import { normalizeSsoGroups, readAmrMethods } from "~/utils/sso.server";
import { randomUsernameFromEmail } from "~/utils/user";
import type { OidcWorkspaceMapping } from "./oidc-workspace-mappings.server";
import {
  canCreateMappedWorkspace,
  getRoleFromOidcGroups,
  oidcWorkspaceMappings,
} from "./oidc-workspace-mappings.server";
import { deleteAuthAccount } from "./service.server";

/**
 * The `amr` method GoTrue records for a sign-in completed through an OAuth or
 * OIDC provider, custom providers included.
 */
const OAUTH_AMR_METHOD = "oauth";

/**
 * Builds the URL that starts the custom OIDC login: Supabase's authorize
 * endpoint for the configured provider. Supabase runs the code exchange with
 * the IdP and then redirects to the callback with the session in the URL
 * fragment, which the callback page reads.
 *
 * The redirect path is built here, never taken from the caller, so it is
 * always an allow-listed, query-free Supabase redirect URL.
 *
 * @param options.platform - `"mobile"` lands on the native-app callback, which
 *   hands the session to the companion app; defaults to the web callback
 * @returns The absolute URL to redirect the browser to
 * @throws {ShelfError} 404 when no provider is configured
 */
export function getOidcAuthorizeUrl({
  platform = "web",
}: { platform?: "web" | "mobile" } = {}): string {
  if (!OIDC_PROVIDER) {
    throw new ShelfError({
      cause: null,
      status: 404,
      title: "Not found",
      message: "This sign-in method is not available.",
      label: "Auth",
      shouldBeCaptured: false,
    });
  }

  const url = new URL(`${SUPABASE_URL.replace(/\/+$/, "")}/auth/v1/authorize`);
  url.searchParams.set("provider", OIDC_PROVIDER);
  url.searchParams.set(
    "redirect_to",
    `${SERVER_URL}/oauth/callback${platform === "mobile" ? "/mobile" : ""}`
  );
  if (OIDC_SCOPES) {
    url.searchParams.set("scopes", OIDC_SCOPES);
  }

  return url.toString();
}

/**
 * Whether a session was obtained through the configured custom OIDC provider.
 *
 * Two things must hold: the access token records an OAuth sign-in, and the
 * auth user holds an identity from the configured provider. A password or
 * email-code session fails the first, so it can never reach the provisioning
 * and group sync below.
 *
 * SECURITY: pass only a session returned by `refreshAccessToken` in this same
 * request. The `amr` claim is read WITHOUT verifying the signature, which is
 * sound only because that token came straight from GoTrue over the server-side
 * refresh (see `assertSsoAuthenticatedSession`).
 *
 * The `amr` method does not name the provider. A deployment that enables
 * another OAuth provider next to the custom one must expect a user holding
 * identities from both to pass with either; the claims acted on are still read
 * from the custom provider's identity only.
 *
 * @param authSession - the session just refreshed server-side
 * @returns true when the session is a custom OIDC sign-in
 */
export async function isOidcAuthenticatedSession(
  authSession: Pick<AuthSession, "accessToken" | "userId">
): Promise<boolean> {
  if (!OIDC_PROVIDER) return false;
  if (!readAmrMethods(authSession.accessToken).includes(OAUTH_AMR_METHOD)) {
    return false;
  }

  const [row] = await db.$queryRaw<{ held: boolean }[]>`
    SELECT EXISTS (
      SELECT 1
      FROM auth.identities
      WHERE user_id = ${authSession.userId}::uuid
        AND provider = ${OIDC_PROVIDER}
    ) AS "held"
  `;

  return row?.held === true;
}

/**
 * Reads one non-empty string claim.
 *
 * @param claims - the identity's `identity_data`
 * @param key - the claim name
 * @returns the trimmed value, or an empty string
 */
function readClaim(claims: Record<string, unknown>, key: string): string {
  const value = claims[key];
  return typeof value === "string" ? value.trim() : "";
}

/**
 * Reads the claims the OIDC callback acts on from the identity GoTrue wrote
 * for the configured provider. They come from `auth.identities` only: never
 * from request input, which the browser controls, and never from
 * `user_metadata`, which the user can edit through Supabase's public API.
 *
 * - Groups: the `OIDC_GROUPS_CLAIM` entry of `custom_claims`. GoTrue copies a
 *   claim there only when the provider's `custom_claims_allowlist` names it.
 * - Names: `given_name` and `family_name`. A provider that sends only a full
 *   `name` has it split at the first space.
 *
 * When the user holds several identities from the provider, the one signed in
 * most recently wins.
 *
 * @param authUserId - the authenticated Supabase auth user id
 * @returns the groups, and the names when the identity carries both
 * @throws {ShelfError} when the lookup fails
 */
export async function getOidcClaimsForAuthUser(
  authUserId: string
): Promise<SsoCallbackClaims> {
  try {
    const [row] = await db.$queryRaw<{ claims: unknown }[]>`
      SELECT identity_data AS claims
      FROM auth.identities
      WHERE user_id = ${authUserId}::uuid
        AND provider = ${OIDC_PROVIDER}
      ORDER BY last_sign_in_at DESC NULLS LAST
      LIMIT 1
    `;

    const claims = asObject(row?.claims);
    const customClaims = asObject(claims.custom_claims);

    let firstName = readClaim(claims, "given_name");
    let lastName = readClaim(claims, "family_name");
    if (!firstName || !lastName) {
      const [first, ...rest] = (
        readClaim(claims, "name") || readClaim(claims, "full_name")
      )
        .split(/\s+/)
        .filter(Boolean);
      firstName = firstName || first || "";
      lastName = lastName || rest.join(" ");
    }
    const hasNames = Boolean(firstName && lastName);

    return {
      groups: normalizeSsoGroups(customClaims[OIDC_GROUPS_CLAIM]),
      firstName: hasNames ? firstName : null,
      lastName: hasNames ? lastName : null,
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
 * Narrows a stored JSON value to an object.
 *
 * @param value - the raw JSON value
 * @returns the object, or an empty one when the value is not an object
 */
function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/**
 * Whether an error is the unique index on `Organization.oidcMappingKey`
 * refusing a second workspace for one mapping entry.
 *
 * @param cause - what `createOrganization` threw
 */
function isMappingKeyConflict(cause: unknown): boolean {
  const original = isLikeShelfError(cause) ? cause.cause : cause;
  return (
    original instanceof PrismaClientKnownRequestError &&
    original.code === "P2002"
  );
}

/**
 * Finds the workspace a mapping entry manages, creating it when it does not
 * exist yet and the signing-in user is one of the entry's admins.
 *
 * A workspace needs an owner, and a group mapping never decides one, so the
 * first mapped administrator to sign in creates the workspace and becomes its
 * owner (`canCreateMappedWorkspace`). Until then the entry has no workspace
 * and its other members are granted nothing. Two administrators signing in at
 * once cannot create two workspaces: the key is unique, and the loser of the
 * race reads the winner's workspace.
 *
 * @param mapping - the entry of the configuration
 * @param userId - the signing-in user, who must already exist in Shelf
 * @param groups - the groups the IdP asserted for the user
 * @returns the workspace, or `null` when it does not exist and this user may
 *   not create it
 * @throws {ShelfError} when the workspace cannot be created
 */
async function findOrCreateMappedWorkspace(
  mapping: OidcWorkspaceMapping,
  userId: string,
  groups: string[]
): Promise<Organization | null> {
  const existing = await db.organization.findUnique({
    where: { oidcMappingKey: mapping.key },
  });
  if (existing || !canCreateMappedWorkspace(mapping, groups)) return existing;

  try {
    return await createOrganization({
      name: mapping.name,
      userId,
      image: null,
      currency: mapping.currency ?? "USD",
      oidcMappingKey: mapping.key,
    });
  } catch (cause) {
    if (!isMappingKeyConflict(cause)) throw cause;
    return db.organization.findUnique({
      where: { oidcMappingKey: mapping.key },
    });
  }
}

/**
 * Resolves the role the signing-in user holds in every workspace of
 * `OIDC_WORKSPACE_MAPPINGS`.
 *
 * Every existing mapped workspace is returned, including those where the
 * groups map to no role: `updateUserFromSSO` revokes a membership the groups
 * no longer justify.
 *
 * @param args.userId - the signing-in user, who must already exist in Shelf
 * @param args.groups - the groups the IdP asserted
 * @returns one entry per mapped workspace that exists
 */
async function resolveOidcWorkspaceRoles({
  userId,
  groups,
}: {
  userId: string;
  groups: string[];
}): Promise<SsoWorkspaceRole[]> {
  const workspaceRoles: SsoWorkspaceRole[] = [];

  for (const mapping of oidcWorkspaceMappings) {
    const organization = await findOrCreateMappedWorkspace(
      mapping,
      userId,
      groups
    );
    if (organization) {
      workspaceRoles.push({
        organization,
        role: getRoleFromOidcGroups(mapping, groups),
      });
    }
  }

  return workspaceRoles;
}

/**
 * Completes a custom OIDC login: makes sure the Shelf user exists and brings
 * their workspace access in line with their groups.
 *
 * - A Shelf user whose id is the authenticated auth user id is a returning
 *   user. This includes an email/password account that Supabase linked the
 *   OIDC identity to because the IdP asserted the same email: it keeps its
 *   data and can sign in both ways.
 * - No such user creates one, flagged as an SSO account (`User.sso`) like a
 *   SAML user: no password, no personal workspace in the switcher. It needs a
 *   first and last name from the IdP.
 * - A different Shelf account that already uses the email is refused: there is
 *   no auth user to link, so an operator has to look at it.
 *
 * Then the mapped workspaces are resolved (creating those the user may own)
 * and `updateUserFromSSO` grants, changes or revokes each membership.
 *
 * @param args.authSession - the session of the OIDC sign-in
 * @param args.firstName - from {@link getOidcClaimsForAuthUser}; null when the
 *   IdP sent no usable name
 * @param args.lastName - see `firstName`
 * @param args.groups - from {@link getOidcClaimsForAuthUser}; never request input
 * @param args.formatPrefs - browser-detected prefs, stamped on a new user only
 * @returns the user and the workspace to land on (null when the groups grant
 *   none)
 * @throws {ShelfError} on refusal or failure
 */
export async function resolveUserAndOrgForOidcCallback({
  authSession,
  firstName,
  lastName,
  groups,
  formatPrefs,
}: {
  authSession: AuthSession;
  firstName: string | null;
  lastName: string | null;
  groups: string[];
  formatPrefs?: DetectedFormatPrefs;
}) {
  const { userId, email } = authSession;

  try {
    const ownAccount = await db.user.findUnique({
      where: { id: userId },
      select: { id: true, deletedAt: true },
    });

    // Deleting an account removes its auth user only after the Shelf row is
    // marked deleted, so a login can arrive in between. It must not update or
    // restore the account.
    if (ownAccount?.deletedAt) {
      throw new ShelfError({
        cause: null,
        status: 403,
        title: "Account deleted",
        message: "This account has been deleted.",
        additionalData: { userId },
        label: "Auth",
        shouldBeCaptured: false,
      });
    }

    if (!ownAccount) {
      const emailOwner = await db.user.findFirst({
        where: { email: caseInsensitiveEmailFilter(email), deletedAt: null },
        select: { id: true },
      });
      if (emailOwner) {
        throw new ShelfError({
          cause: null,
          status: 409,
          title: "Account needs attention",
          message:
            "This email already has a Shelf account that is not linked to this sign-in method. Please contact your administrator.",
          additionalData: { userId, existingUserId: emailOwner.id },
          label: "Auth",
        });
      }

      // There is no stored name to fall back on, so an IdP that sends none
      // cannot create an account.
      if (!firstName || !lastName) {
        throw new ShelfError({
          cause: null,
          status: 400,
          title: "Missing name",
          message:
            "Your identity provider did not provide your first and last name. Please contact your administrator.",
          additionalData: { userId },
          label: "SSO",
          shouldBeCaptured: false,
        });
      }

      try {
        await createUser({
          email,
          firstName,
          lastName,
          userId,
          username: randomUsernameFromEmail(email),
          isSSO: true,
          formatPrefs,
        });
      } catch (createError) {
        // The auth user exists only because of this login. Without a Shelf
        // user it is an account nobody can use, so it is removed again.
        await deleteAuthAccount(userId);
        throw createError;
      }
    }

    const workspaceRoles = await resolveOidcWorkspaceRoles({ userId, groups });

    // Read after the workspaces are resolved: creating one made this user its
    // owner, and `updateUserFromSSO` decides from the memberships it is given.
    const user = await db.user.findUniqueOrThrow({
      where: { id: userId },
      select: USER_WITH_SSO_DETAILS_SELECT,
    });

    const response = await updateUserFromSSO(authSession, user, {
      // A missing claim never blanks a stored name.
      firstName: firstName ?? user.firstName ?? "",
      lastName: lastName ?? user.lastName ?? "",
      groups,
      workspaceRoles,
    });

    return { user: response.user, org: response.org };
  } catch (cause) {
    throw new ShelfError({
      cause,
      status: isLikeShelfError(cause) ? cause.status : undefined,
      title: isLikeShelfError(cause) ? cause.title : "Authentication failed",
      message: isLikeShelfError(cause)
        ? cause.message
        : "Failed to authenticate user",
      // The auth user id identifies the login for support without writing the
      // address to the server logs.
      additionalData: { userId },
      label: "Auth",
      shouldBeCaptured: isLikeShelfError(cause) ? cause.shouldBeCaptured : true,
    });
  }
}
