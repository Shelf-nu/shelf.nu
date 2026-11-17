/**
 * Custom OIDC login start.
 *
 * A resource route with no UI: its loader redirects the browser to Supabase's
 * authorize endpoint for the provider configured in `OIDC_PROVIDER`. Supabase
 * signs the user in with the identity provider and redirects back to
 * `/oauth/callback` (or `/oauth/callback/mobile` for `?platform=mobile`),
 * where the login is completed.
 *
 * The login page and the SSO login page link here from their "Log in with ..."
 * button. The link must load the document (`reloadDocument`), because the
 * redirect leaves the app.
 *
 * @see {@link file://./../../modules/auth/oidc.server.ts} getOidcAuthorizeUrl
 * @see {@link file://./oauth.callback.tsx}
 * @see {@link file://./sso-login.tsx} sets the PKCE cookie of the mobile flow
 */
import type { LoaderFunctionArgs } from "react-router";
import { data, redirect } from "react-router";
import { getOidcAuthorizeUrl } from "~/modules/auth/oidc.server";
import { makeShelfError } from "~/utils/error";
import { error } from "~/utils/http.server";

/**
 * Redirects to the identity provider through Supabase.
 *
 * The native-app flow (`?platform=mobile`) is not short-circuited for an
 * authenticated browser: the in-app browser may carry a stale web cookie, and
 * the app still needs the handoff to obtain its own session.
 *
 * @returns A redirect to the authorize URL, or to the app for a browser that
 *   is already signed in
 * @throws A 404 response when the custom OIDC login is not configured
 */
export function loader({ context, request }: LoaderFunctionArgs) {
  const isMobile =
    new URL(request.url).searchParams.get("platform") === "mobile";

  try {
    if (context.isAuthenticated && !isMobile) {
      return redirect("/");
    }

    return redirect(
      getOidcAuthorizeUrl({ platform: isMobile ? "mobile" : "web" })
    );
  } catch (cause) {
    const reason = makeShelfError(cause);
    throw data(error(reason), { status: reason.status });
  }
}
