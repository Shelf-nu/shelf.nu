/**
 * Custom OIDC login start.
 *
 * A resource route with no UI: its loader starts a PKCE sign-in with the
 * provider configured in `OIDC_PROVIDER` and redirects the browser to
 * Supabase's authorize endpoint. Supabase signs the user in with the identity
 * provider and redirects back to `/oauth/callback` (or `/oauth/callback/mobile`
 * for `?platform=mobile`) with `?code=`, which the callback trades for the
 * session with the verifier this route stored in the `sso_code_verifier`
 * cookie. A callback link opened in any other browser therefore cannot
 * complete.
 *
 * The login page and the SSO login page link here from their "Log in with ..."
 * button. The link must load the document (`reloadDocument`), because the
 * redirect leaves the app.
 *
 * @see {@link file://./../../modules/auth/sso-pkce.server.ts} startOidcSignIn
 * @see {@link file://./oauth.callback.tsx}
 * @see {@link file://./sso-login.tsx} sets the PKCE cookie of the native-app flow
 */
import type { LoaderFunctionArgs } from "react-router";
import { data, redirect } from "react-router";
import { startOidcSignIn } from "~/modules/auth/sso-pkce.server";
import { getClientIpFromHeaders } from "~/utils/client-ip.server";
import { setSsoCodeVerifier } from "~/utils/cookies.server";
import { makeShelfError } from "~/utils/error";
import { error } from "~/utils/http.server";

/**
 * Starts the sign-in and redirects to the identity provider through Supabase.
 *
 * The native-app flow (`?platform=mobile`) is not short-circuited for an
 * authenticated browser: the in-app browser may carry a stale web cookie, and
 * the app still needs the handoff to obtain its own session.
 *
 * @returns A redirect to the authorize URL that stores the code verifier, or
 *   to the app for a browser that is already signed in
 * @throws A 404 response when the custom OIDC login is not configured
 */
export async function loader({ context, request }: LoaderFunctionArgs) {
  const isMobile =
    new URL(request.url).searchParams.get("platform") === "mobile";

  try {
    if (context.isAuthenticated && !isMobile) {
      return redirect("/");
    }

    const { url, codeVerifier } = await startOidcSignIn({
      platform: isMobile ? "mobile" : "web",
      clientIp: getClientIpFromHeaders(request.headers),
    });

    // The callback can only trade Supabase's code for a session with this
    // verifier, so only this browser can finish the sign-in.
    return redirect(url, {
      headers: { "Set-Cookie": await setSsoCodeVerifier(codeVerifier) },
    });
  } catch (cause) {
    const reason = makeShelfError(cause);
    throw data(error(reason), { status: reason.status });
  }
}
