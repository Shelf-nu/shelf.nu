/**
 * Mobile SSO callback (native-app web-delegated auth).
 *
 * Supabase redirects here (instead of `/oauth/callback`) after it validates the
 * SAML assertion for a `platform=mobile` SSO sign-in, with an authorization
 * code on the URL. The action trades that code for the SSO session using the
 * PKCE verifier this browser kept when `/sso-login` started the sign-in, so a
 * callback link opened in any other browser cannot complete. A sign-in started
 * from the identity provider's dashboard never lands here, so tokens in the URL
 * fragment are never accepted.
 *
 * SSO completion then matches the web callback (user and workspace
 * provisioning, SCIM linking via `resolveUserAndOrgForSsoCallback`), except
 * that instead of setting a web session it mints a single-use authorization
 * code for the app and hands it back through the `shelf://auth-callback?code=`
 * deeplink. The app redeems that code at `POST /api/mobile/exchange`, proving
 * with its own PKCE verifier that it started the sign-in.
 *
 * No tokens ever appear in the deeplink, only the short-lived, single-use code.
 *
 * @see apps/webapp/app/modules/auth/mobile-sso.server.ts
 * @see apps/webapp/app/routes/api+/mobile+/exchange.ts
 * @see apps/webapp/app/modules/auth/sso-pkce.server.ts
 * @see apps/webapp/app/routes/_auth+/oauth.callback.tsx (web counterpart)
 */

import { useEffect, useRef } from "react";

import type { ActionFunctionArgs, MetaFunction } from "react-router";
import { data, useFetcher } from "react-router";
import { z } from "zod";
import { Button } from "~/components/shared/button";
import { Spinner } from "~/components/shared/spinner";
import { config } from "~/config/shelf.config";
import { useSearchParams } from "~/hooks/search-params";
import { SsoAccountLinkedNotice } from "~/modules/auth/components/sso-account-linked-notice";
import {
  createMobileAuthCode,
  deleteExpiredMobileAuthCodes,
} from "~/modules/auth/mobile-sso.server";
import { exchangeSsoCode } from "~/modules/auth/sso-pkce.server";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";
import { detectFormatPrefsForPersistence } from "~/utils/client-hints";
import { getClientIpFromHeaders } from "~/utils/client-ip.server";
import {
  clearSsoCodeVerifier,
  mobilePkceChallengeCookie,
  ssoCodeVerifierCookie,
} from "~/utils/cookies.server";
import { makeShelfError, notAllowedMethod, ShelfError } from "~/utils/error";
import {
  getActionMethod,
  logException,
  parseData,
  payload,
  readFormData,
} from "~/utils/http.server";
import { readProviderError } from "~/utils/sso-callback";
import {
  assertSsoAuthenticatedSession,
  getSsoClaimsForAuthUser,
  isSsoAccountLinkedError,
  resolveUserAndOrgForSsoCallback,
} from "~/utils/sso.server";

/** Custom-scheme deeplink the companion app registers and listens for. */
const MOBILE_CALLBACK_URL = "shelf://auth-callback";

/**
 * What the page posts: only the `?code=` Supabase put on the callback URL.
 * Every claim the action acts on (groups, names, contact info) is read
 * server-side with `getSsoClaimsForAuthUser`, never from the form.
 */
const MobileCallbackSchema = z.object({
  code: z.string().min(1),
});

export async function action({ request }: ActionFunctionArgs) {
  const { disableSSO } = config;
  // Clears the one-shot PKCE challenge cookie. Applied on every exit path —
  // success (once the challenge is bound to the code) and failure (so an
  // abandoned flow doesn't leave the challenge readable for its full TTL).
  const clearChallengeCookie = await mobilePkceChallengeCookie.serialize("", {
    maxAge: 0,
  });
  // The SSO code verifier is single-use as well, and cleared on the same paths.
  const responseHeaders = new Headers();
  responseHeaders.append("Set-Cookie", clearChallengeCookie);
  responseHeaders.append("Set-Cookie", await clearSsoCodeVerifier());
  try {
    if (disableSSO) {
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

    const method = getActionMethod(request);

    switch (method) {
      case "POST": {
        // why: readFormData (not request.formData()) so a malformed body / wrong
        // Content-Type is downgraded to a non-captured 400, rather than a
        // TypeError that logException would otherwise surface as a captured 5xx.
        const { code: supabaseCode } = parseData(
          await readFormData(request),
          MobileCallbackSchema
        );

        // Only the browser that started this sign-in holds the verifier.
        const authSession = await exchangeSsoCode({
          code: supabaseCode,
          codeVerifier: await ssoCodeVerifierCookie.parse(
            request.headers.get("Cookie")
          ),
          clientIp: getClientIpFromHeaders(request.headers),
        });
        // Any Supabase session would pass the steps below, so refuse one that
        // was not obtained through SSO before anything is provisioned or synced.
        await assertSsoAuthenticatedSession(authSession);
        const { groups, firstName, lastName, contactInfo } =
          await getSsoClaimsForAuthUser({
            authUserId: authSession.userId,
            email: authSession.email,
          });

        // Provision the user/org exactly as the web flow does (creates the user
        // on first login, links SCIM groups). The app's bearer-auth API looks
        // the user up by auth id, so this must run before we mint a code.
        // Same detection as the web callback; timeZone is null when the mobile
        // Request lacks the CH-time-zone cookie (see
        // detectFormatPrefsForPersistence), so the lazy backfill fills the real
        // zone later rather than sticking on the "UTC" fallback.
        const formatPrefs = detectFormatPrefsForPersistence(request);
        const { user } = await resolveUserAndOrgForSsoCallback({
          authSession,
          firstName,
          lastName,
          groups,
          contactInfo,
          formatPrefs,
        });

        // The app's API resolves the Shelf user by the session's auth user id.
        // A sign-in that resolved to an account with another id would hand the
        // app a session no request could use, so refuse it here, plainly.
        if (user.id !== authSession.userId) {
          throw new ShelfError({
            cause: null,
            status: 409,
            title: "Account needs attention",
            message:
              "Your Shelf account is not linked to this single sign-on login yet. Please contact support.",
            additionalData: {
              authUserId: authSession.userId,
              userId: user.id,
            },
            label: "Auth",
          });
        }

        // PKCE: `/sso-login` stashes the S256 challenge in a short-lived cookie
        // at the start of the flow. Bind it to the auth code so the exchange
        // must present a matching verifier. Whenever that cookie does not reach
        // us the code is minted unbound, and redemption refuses it outright —
        // an unbound code is never honoured as a bearer token.
        const codeChallenge = await mobilePkceChallengeCookie.parse(
          request.headers.get("Cookie")
        );

        // Hand the device a single-use code via the deeplink, never tokens. The
        // code carries this SSO session, which the app receives at the exchange:
        // nothing here uses the session after this point, so the app is its only
        // holder.
        const code = await createMobileAuthCode({
          userId: authSession.userId,
          refreshToken: authSession.refreshToken,
          codeChallenge:
            typeof codeChallenge === "string" ? codeChallenge : undefined,
        });

        // Drop expired codes, and the sessions abandoned ones still carry.
        // Fire-and-forget: a cleanup failure must never affect the sign-in.
        void deleteExpiredMobileAuthCodes().catch(() => undefined);

        return data(
          payload({
            deeplink: `${MOBILE_CALLBACK_URL}?code=${encodeURIComponent(code)}`,
          }),
          // Clear the one-shot cookies now that the challenge is bound to the code.
          { headers: responseHeaders }
        );
      }
    }

    throw notAllowedMethod(method);
  } catch (cause) {
    // The account was moved onto SSO and the person must sign in once more:
    // an outcome to report, not a failure.
    if (isSsoAccountLinkedError(cause)) {
      return data(
        payload({ ssoAccountLinked: true as const, message: cause.message }),
        { headers: responseHeaders }
      );
    }
    const reason = makeShelfError(cause);
    // why: the client renders `result.error` and never re-throws, so without an
    // explicit log a genuine 5xx (refresh-token exchange, user/org provisioning,
    // or code mint failing) would never reach Sentry. `logException` mirrors
    // `error()`'s logging (5xx → Sentry, handled 4xx → trail, aborts skipped).
    logException(reason);
    return data(
      { error: { message: reason.message } },
      {
        status: reason.status,
        headers: responseHeaders,
      }
    );
  }
}

export function loader() {
  const title = "Signing you in";
  const subHeading = "Please wait while we connect your account";

  return data(payload({ title, subHeading }));
}

export const meta: MetaFunction<typeof loader> = ({ data }) => [
  { title: data ? appendToMetaTitle(data.title) : "" },
];

export default function MobileLoginCallback() {
  const fetcher = useFetcher<typeof action>();
  const { data: result, submit } = fetcher;
  const [searchParams] = useSearchParams();
  const code = searchParams.get("code");
  /** Supabase reports a failed sign-in on the callback URL itself. */
  const providerError = readProviderError(searchParams);
  /** The code is posted once, re-renders included. */
  const codePosted = useRef(false);

  useEffect(() => {
    if (!code || codePosted.current) return;
    codePosted.current = true;
    void submit({ code }, { method: "post" });
  }, [code, submit]);

  // Once the server returns the deeplink, bounce back into the app. In the
  // system browser opened by `expo-web-browser`, navigating to the `shelf://`
  // scheme closes the auth session and returns the code to the app.
  useEffect(() => {
    if (result && "deeplink" in result && result.deeplink) {
      window.location.href = result.deeplink;
    }
  }, [result]);

  const linkedNotice =
    result && "ssoAccountLinked" in result && result.ssoAccountLinked
      ? result.message
      : null;
  const errorMessage =
    (result && "error" in result ? result.error?.message : undefined) ??
    providerError ??
    // Without a code this page was not reached from a sign-in the app started.
    (code ? undefined : "Please start the sign-in from the Shelf app.");

  return (
    <div className="flex justify-center text-center">
      {linkedNotice ? (
        <SsoAccountLinkedNotice variant="mobile" />
      ) : errorMessage ? (
        <div>
          <div className="text-sm text-error-500">{errorMessage}</div>
          <Button to="/" className="mt-4">
            Back to login
          </Button>
        </div>
      ) : (
        <Spinner />
      )}
    </div>
  );
}
