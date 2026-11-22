/**
 * SSO Callback
 *
 * The one step the web and the native-app callback routes share: turning the
 * session Supabase issued for a single sign-on login into a provisioned Shelf
 * user. Two kinds of login arrive at the same routes:
 *
 * - the custom OIDC login (`OIDC_PROVIDER`), handled by `oidc.server.ts`;
 * - the domain-based SAML SSO, handled by `~/utils/sso.server`.
 *
 * A session that is neither is refused and revoked before anything is
 * provisioned or synced.
 *
 * @see {@link file://./oidc.server.ts}
 * @see {@link file://./../../utils/sso.server.ts}
 * @see {@link file://./../../routes/_auth+/oauth.callback.tsx}
 * @see {@link file://./../../routes/_auth+/oauth.callback_.mobile.tsx}
 */
import type { AuthSession } from "@server/session";
import { config } from "~/config/shelf.config";
import type { DetectedFormatPrefs } from "~/utils/date-format";
import { ShelfError } from "~/utils/error";
import {
  assertSsoAuthenticatedSession,
  getSsoClaimsForAuthUser,
  isSamlSession,
  resolveUserAndOrgForSsoCallback,
} from "~/utils/sso.server";
import {
  getOidcClaimsForAuthUser,
  isOidcAuthenticatedSession,
  resolveUserAndOrgForOidcCallback,
} from "./oidc.server";
import { revokeSession } from "./service.server";

/**
 * Whether any single sign-on method is available on this deployment. The
 * callback routes and the SSO login page are closed when none is.
 *
 * @returns true when SAML SSO or the custom OIDC login is enabled
 */
export function isAnySsoEnabled(): boolean {
  return !config.disableSSO || config.oidc.enabled;
}

/**
 * Whether a session was obtained through one of this deployment's identity
 * providers: SAML SSO, or the configured custom OIDC provider (see
 * `isOidcAuthenticatedSession` for why an OAuth session must be tied to it).
 * Use it to decide whether a session may skip a check that applies only to
 * signing in with an email address.
 *
 * SECURITY: pass only a token Supabase Auth vouched for, see
 * `isSingleSignOnSession` in `~/utils/sso.server`.
 *
 * @param session - the session's access token and its auth user id
 * @returns true for a SAML session or a session of the custom OIDC provider
 */
export async function isIdentityProviderSession(
  session: Pick<AuthSession, "accessToken" | "userId">
): Promise<boolean> {
  if (isSamlSession(session.accessToken)) return true;
  return isOidcAuthenticatedSession(session);
}

/**
 * Completes a single sign-on login from the session the callback route just
 * refreshed: checks how the session was obtained, reads the claims from the
 * identity Supabase stored, and provisions the user and their workspace
 * access.
 *
 * SECURITY: pass only a session Supabase Auth issued to the server in this
 * same request (`exchangeSsoCode` or `refreshAccessToken`). Both checks read the access token's `amr` claim without verifying
 * its signature (see `assertSsoAuthenticatedSession`).
 *
 * @param args.authSession - the session just refreshed server-side
 * @param args.formatPrefs - browser-detected prefs, stamped on a new user only
 * @returns the user and the workspace to land on (null when the login grants
 *   access to none)
 * @throws {ShelfError} 403 when the session was not obtained through an
 *   enabled single sign-on method (the session is revoked first); the
 *   account-linked notice (`isSsoAccountLinkedError`) after a SAML duplicate
 *   merge; other ShelfErrors on refusal or failure
 */
export async function completeSsoCallback({
  authSession,
  formatPrefs,
}: {
  authSession: AuthSession;
  formatPrefs?: DetectedFormatPrefs;
}) {
  if (config.oidc.enabled && (await isOidcAuthenticatedSession(authSession))) {
    const { groups, firstName, lastName } = await getOidcClaimsForAuthUser(
      authSession.userId
    );
    return resolveUserAndOrgForOidcCallback({
      authSession,
      firstName,
      lastName,
      groups,
      formatPrefs,
    });
  }

  // Any Supabase session would pass the steps below, so refuse one that was
  // not obtained through SSO before anything is provisioned or synced.
  await assertSsoAuthenticatedSession(authSession);

  // The routes stay open for the OIDC login while SAML SSO is switched off, so
  // a SAML session is refused here.
  if (config.disableSSO) {
    await revokeSession(authSession.accessToken);
    throw new ShelfError({
      cause: null,
      title: "SSO is disabled",
      message:
        "For more information, please contact your workspace administrator.",
      label: "User onboarding",
      status: 403,
      shouldBeCaptured: false,
    });
  }

  const { groups, firstName, lastName, contactInfo } =
    await getSsoClaimsForAuthUser({
      authUserId: authSession.userId,
      email: authSession.email,
    });

  /**
   * This resolves the correct org we should redirect the user to
   * Also it handles:
   * - Creating a new user if the user doesn't exist
   * - Throwing an error if the user is already connected to an email account
   * - Linking the user to the correct org if SCIM is configured
   */
  return resolveUserAndOrgForSsoCallback({
    authSession,
    firstName,
    lastName,
    groups,
    contactInfo,
    formatPrefs,
  });
}
