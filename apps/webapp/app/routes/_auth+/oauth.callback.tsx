/**
 * Web SSO callback: where Supabase sends the browser after the identity
 * provider signs someone in.
 *
 * Two ways in, handled differently:
 *
 * - **Started at `/sso-login`** (the usual way): the URL carries `?code=`. The
 *   page posts it, and the action trades it for the session with the PKCE
 *   verifier this browser kept in its `sso_code_verifier` cookie. A link
 *   forwarded to another browser has no verifier and cannot complete.
 * - **Started from the identity provider's dashboard** (an Okta tile, say): no
 *   sign-in began here, so there is no verifier, and Supabase puts tokens in
 *   the URL fragment instead. The page asks the server whose account the token
 *   signs in, shows it, and signs in only after the person confirms. Signing
 *   someone into an account that is not theirs then needs them to accept a
 *   stranger's email, never a silent redirect.
 *
 * Both end in the same server-side steps: refuse sessions not obtained through
 * SSO, read the IdP claims from the identity, provision the user and workspace,
 * set the session.
 *
 * @see {@link file://./../../modules/auth/sso-pkce.server.ts}
 * @see {@link file://./oauth.callback_.mobile.tsx} native-app counterpart
 */
import { useEffect, useRef } from "react";

import type {
  ActionFunctionArgs,
  LoaderFunctionArgs,
  MetaFunction,
} from "react-router";
import { data, redirect, useFetcher } from "react-router";
import { z } from "zod";
import type { AuthSession } from "@server/session";
import { Button } from "~/components/shared/button";
import { Spinner } from "~/components/shared/spinner";
import { config } from "~/config/shelf.config";
import { useSearchParams } from "~/hooks/search-params";
import { useDisabled } from "~/hooks/use-disabled";
import { supabaseClient } from "~/integrations/supabase/client";
import { SsoAccountLinkedNotice } from "~/modules/auth/components/sso-account-linked-notice";
import { refreshAccessToken } from "~/modules/auth/service.server";
import {
  exchangeSsoCode,
  readTokenAccount,
  ssoSignInExpiredError,
} from "~/modules/auth/sso-pkce.server";
import { setSelectedOrganizationIdCookie } from "~/modules/organization/context.server";
import {
  getUserOrganizations,
  isSsoUser,
} from "~/modules/organization/service.server";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";
import { detectFormatPrefsForPersistence } from "~/utils/client-hints";
import { getClientIpFromHeaders } from "~/utils/client-ip.server";
import {
  clearSsoCodeVerifier,
  expireListPreferenceCookies,
  setCookie,
  ssoCodeVerifierCookie,
} from "~/utils/cookies.server";
import { makeShelfError, notAllowedMethod, ShelfError } from "~/utils/error";
import {
  payload,
  error,
  getActionMethod,
  parseData,
  safeRedirect,
} from "~/utils/http.server";
import { readProviderError } from "~/utils/sso-callback";
import {
  assertSsoAuthenticatedSession,
  getSsoClaimsForAuthUser,
  isSsoAccountLinkedError,
  resolveUserAndOrgForSsoCallback,
} from "~/utils/sso.server";

/**
 * What the page posts. Every claim the action acts on (groups, names, contact
 * info) is read server-side with `getSsoClaimsForAuthUser`, never from the
 * form.
 *
 * - `code`: the `?code=` of a sign-in started at `/sso-login`.
 * - `identify`: the access token of a dashboard sign-in, to learn whose
 *   account it is before asking the person to confirm.
 * - `confirm`: the person confirmed; the tokens of that dashboard sign-in.
 */
const CallbackSchema = z.discriminatedUnion("intent", [
  z.object({
    intent: z.literal("code"),
    code: z.string().min(1),
    redirectTo: z.string().optional(),
  }),
  z.object({
    intent: z.literal("identify"),
    accessToken: z.string().min(1),
  }),
  z.object({
    intent: z.literal("confirm"),
    accessToken: z.string().min(1),
    refreshToken: z.string().min(1),
    redirectTo: z.string().optional(),
  }),
]);

/**
 * Finishes an SSO sign-in for a session the server obtained itself: refuses a
 * session not obtained through SSO, provisions the user from the identity's
 * claims, sets the session and redirects to where the person lands.
 *
 * @param args.authSession - The SSO session
 * @param args.request - The callback request (for format-preference hints and
 *   list-preference cookies)
 * @param args.setSession - Stores the session on the response
 * @param args.redirectTo - Where to land when the person belongs to a team
 * @param args.headers - Extra `Set-Cookie` headers for the response
 * @returns The redirect response
 */
async function completeSsoSignIn({
  authSession,
  request,
  setSession,
  redirectTo,
  headers,
}: {
  authSession: AuthSession;
  request: Request;
  setSession: (session: AuthSession) => void;
  redirectTo?: string;
  headers: [string, string][];
}) {
  // Any Supabase session would pass the steps below, so refuse one that was
  // not obtained through SSO before anything is provisioned or synced.
  await assertSsoAuthenticatedSession(authSession);
  const { groups, firstName, lastName, contactInfo } =
    await getSsoClaimsForAuthUser({
      authUserId: authSession.userId,
      email: authSession.email,
    });

  /**
   * Resolves the workspace to land in, and also:
   * - creates the user if they do not exist
   * - refuses when the email already belongs to a non-SSO account
   * - links the user to their workspace when SCIM is configured
   */
  // Detect the caller's date/time/week/timezone prefs from browser hints; only
  // the new-user branch of the resolver consumes them. timeZone is null when
  // the CH-time-zone cookie is absent, so the "UTC" fallback is never stamped
  // permanently (the lazy backfill fills it).
  const formatPrefs = detectFormatPrefsForPersistence(request);
  const { org } = await resolveUserAndOrgForSsoCallback({
    authSession,
    firstName,
    lastName,
    groups,
    contactInfo,
    formatPrefs,
  });

  setSession(authSession);
  // Whatever lists this browser remembers belong to whoever used it last.
  const listPreferenceExpiries = await expireListPreferenceCookies(request, {
    event: "sign-in",
  });
  const responseHeaders = [...headers, ...listPreferenceExpiries];

  // SCIM-linked sign-in: land in that workspace.
  if (org?.id) {
    return redirect(safeRedirect(redirectTo || "/"), {
      headers: [
        ...responseHeaders,
        setCookie(await setSelectedOrganizationIdCookie(org.id)),
      ],
    });
  }

  // Without a team workspace (from SCIM or an earlier invite), an SSO user
  // waits for assignment instead of landing in a hidden personal workspace.
  const userOrgs = await getUserOrganizations({
    userId: authSession.userId,
  });
  const isSSO = await isSsoUser({
    userId: authSession.userId,
    userOrganizations: userOrgs,
  });
  const hasTeamOrgs = userOrgs.some(
    (uo) => uo.organization.type !== "PERSONAL"
  );

  if (isSSO && !hasTeamOrgs) {
    return redirect("/sso-pending-assignment", { headers: responseHeaders });
  }

  return redirect(safeRedirect(redirectTo || "/"), {
    headers: responseHeaders,
  });
}

export async function action({ request, context }: ActionFunctionArgs) {
  const { disableSSO } = config;
  // The verifier is single-use: every answer to a code exchange removes it.
  // Answers to a dashboard sign-in leave it, so a sign-in another tab started
  // at /sso-login can still finish.
  const clearVerifier = setCookie(await clearSsoCodeVerifier());
  let verifierUsed = false;

  try {
    // The callback serves only SSO; a social login provider would need its
    // own handling here.
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
        const form = parseData(await request.formData(), CallbackSchema);

        switch (form.intent) {
          case "code": {
            verifierUsed = true;
            const codeVerifier = await ssoCodeVerifierCookie.parse(
              request.headers.get("Cookie")
            );
            const authSession = await exchangeSsoCode({
              code: form.code,
              codeVerifier,
              clientIp: getClientIpFromHeaders(request.headers),
            });
            return await completeSsoSignIn({
              authSession,
              request,
              setSession: context.setSession,
              redirectTo: form.redirectTo,
              headers: [clearVerifier],
            });
          }

          case "identify": {
            // A sign-in this browser started never arrives with tokens. One
            // that did not start here gets named and must be confirmed.
            const { email } = await readTokenAccount(form.accessToken);
            return data(payload({ confirmAccount: { email } }));
          }

          case "confirm": {
            // The person confirmed the account `identify` named for this
            // access token, so the session must belong to that same account.
            // The browser posts both tokens, so neither is trusted alone.
            const [account, authSession] = await Promise.all([
              readTokenAccount(form.accessToken),
              refreshAccessToken(form.refreshToken, {
                clientIp: getClientIpFromHeaders(request.headers),
              }),
            ]);
            if (authSession.userId !== account.userId) {
              throw ssoSignInExpiredError();
            }
            return await completeSsoSignIn({
              authSession,
              request,
              setSession: context.setSession,
              redirectTo: form.redirectTo,
              headers: [],
            });
          }
        }
      }
    }

    throw notAllowedMethod(method);
  } catch (cause) {
    const headers = verifierUsed ? [clearVerifier] : [];
    // The account was moved onto SSO and the person must sign in once more:
    // an outcome to report, not a failure.
    if (isSsoAccountLinkedError(cause)) {
      return data(
        payload({ ssoAccountLinked: true as const, message: cause.message }),
        { headers }
      );
    }
    const reason = makeShelfError(cause);
    return data(error(reason), { status: reason.status, headers });
  }
}

export function loader({ context }: LoaderFunctionArgs) {
  const title = "Signing in via SSO";
  const subHeading = "Please wait while we connect your account";

  if (context.isAuthenticated) {
    return redirect("/");
  }

  return data(payload({ title, subHeading }));
}

export const meta: MetaFunction<typeof loader> = ({ data }) => [
  { title: data ? appendToMetaTitle(data.title) : "" },
];

/** Tokens of a dashboard sign-in, held until the person confirms. */
type FragmentTokens = { accessToken: string; refreshToken: string };

export default function LoginCallback() {
  const fetcher = useFetcher<typeof action>();
  const { data, submit } = fetcher;
  const disabled = useDisabled(fetcher);
  const [searchParams] = useSearchParams();
  const redirectTo = searchParams.get("redirectTo") ?? "/";
  const code = searchParams.get("code");
  /** Supabase reports a failed sign-in on the callback URL itself. */
  const providerError = readProviderError(searchParams);

  /** Each code and each set of tokens is posted once, re-renders included. */
  const codePosted = useRef(false);
  const fragmentTokens = useRef<FragmentTokens | null>(null);

  // Started at /sso-login: trade the code for the session.
  useEffect(() => {
    if (!code || codePosted.current) return;
    codePosted.current = true;
    void submit({ intent: "code", code, redirectTo }, { method: "post" });
  }, [code, submit, redirectTo]);

  // Started from the identity provider's dashboard: the Supabase client reads
  // the tokens from the URL fragment (not readable server-side). Ask the
  // server whose account they sign in, and hold them until the person
  // confirms.
  useEffect(() => {
    if (code) return;

    const {
      data: { subscription },
    } = supabaseClient.auth.onAuthStateChange((event, session) => {
      if (event !== "SIGNED_IN" && event !== "INITIAL_SESSION") return;
      if (!session?.access_token || !session.refresh_token) return;
      if (fragmentTokens.current) return;

      fragmentTokens.current = {
        accessToken: session.access_token,
        refreshToken: session.refresh_token,
      };
      void submit(
        { intent: "identify", accessToken: session.access_token },
        { method: "post" }
      );
    });

    return () => {
      subscription.unsubscribe();
    };
  }, [code, submit]);

  function confirmAccount() {
    const tokens = fragmentTokens.current;
    if (!tokens) return;
    void submit(
      { intent: "confirm", ...tokens, redirectTo },
      { method: "post" }
    );
  }

  const linkedNotice =
    data && "ssoAccountLinked" in data && data.ssoAccountLinked
      ? data.message
      : null;
  const confirmEmail =
    data && "confirmAccount" in data ? data.confirmAccount.email : null;
  const errorMessage = data?.error?.message ?? providerError;

  if (linkedNotice) {
    return (
      <div className="flex justify-center text-center">
        <SsoAccountLinkedNotice variant="web" />
      </div>
    );
  }

  if (errorMessage) {
    return (
      <div className="flex justify-center text-center">
        <div>
          <div className="text-sm text-error-500">{errorMessage}</div>
          <Button to="/" className="mt-4">
            Back to login
          </Button>
        </div>
      </div>
    );
  }

  if (confirmEmail) {
    return (
      <div className="flex flex-col gap-4 text-center">
        <h2 className="text-lg font-semibold text-gray-900">
          Continue to Shelf?
        </h2>
        <p className="text-sm text-gray-600">
          You are signing in as{" "}
          <span className="font-semibold text-gray-900">{confirmEmail}</span>.
          Continue only if this is your account.
        </p>
        <div className="flex flex-col gap-2">
          <Button
            type="button"
            width="full"
            disabled={disabled}
            onClick={confirmAccount}
          >
            {disabled ? "Signing in..." : "Continue"}
          </Button>
          <Button to="/" variant="secondary" width="full">
            Cancel
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex justify-center text-center">
      <Spinner />
    </div>
  );
}
