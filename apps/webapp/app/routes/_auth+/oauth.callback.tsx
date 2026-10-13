import { useEffect, useMemo } from "react";

import type {
  ActionFunctionArgs,
  LoaderFunctionArgs,
  MetaFunction,
} from "react-router";
import { data, redirect, useFetcher } from "react-router";
import { z } from "zod";
import { Button } from "~/components/shared/button";
import { Spinner } from "~/components/shared/spinner";
import { config } from "~/config/shelf.config";
import { useSearchParams } from "~/hooks/search-params";
import { supabaseClient } from "~/integrations/supabase/client";
import { SsoAccountLinkedNotice } from "~/modules/auth/components/sso-account-linked-notice";
import { refreshAccessToken } from "~/modules/auth/service.server";
import { setSelectedOrganizationIdCookie } from "~/modules/organization/context.server";
import {
  getUserOrganizations,
  isSsoUser,
} from "~/modules/organization/service.server";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";
import { createSSOFormData } from "~/utils/auth";
import { detectFormatPrefsForPersistence } from "~/utils/client-hints";
import { setCookie } from "~/utils/cookies.server";
import { makeShelfError, notAllowedMethod, ShelfError } from "~/utils/error";
import {
  payload,
  error,
  getActionMethod,
  parseData,
  safeRedirect,
} from "~/utils/http.server";
import {
  assertSsoAuthenticatedSession,
  getSsoClaimsForAuthUser,
  isSsoAccountLinkedError,
  resolveUserAndOrgForSsoCallback,
} from "~/utils/sso.server";

/**
 * The fields the browser posts after an SSO sign-in: only the refresh token and
 * where to land. Every claim the action acts on (groups, names, contact info)
 * is read server-side with `getSsoClaimsForAuthUser`, never from the form.
 */
const CallbackSchema = z.object({
  refreshToken: z.string().min(1),
  redirectTo: z.string().optional(),
});

export async function action({ request, context }: ActionFunctionArgs) {
  const { disableSSO } = config;
  try {
    /**
     * Currently the only reason to use oauth/callback is for SSO reasons.
     * Once we start adding social login providers, this will need to be adjusted
     */
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
        const { refreshToken, redirectTo } = parseData(
          await request.formData(),
          CallbackSchema
        );

        // We should not trust what is sent from the client
        // https://github.com/rphlmr/supa-fly-stack/issues/45
        const authSession = await refreshAccessToken(refreshToken);
        // Any Supabase refresh token refreshes, so refuse a session that was
        // not obtained through SSO before anything is provisioned or synced.
        await assertSsoAuthenticatedSession(authSession);
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
        // Detect the caller's date/time/week/timezone prefs from browser hints;
        // only the new-user branch of the resolver consumes them. timeZone is
        // null when the CH-time-zone cookie is absent — common on SSO/OAuth
        // callbacks, which don't render ClientHintCheck first — so the "UTC"
        // fallback is never stamped permanently (the lazy backfill fills it).
        const formatPrefs = detectFormatPrefsForPersistence(request);
        const { org } = await resolveUserAndOrgForSsoCallback({
          authSession,
          firstName,
          lastName,
          groups,
          contactInfo,
          formatPrefs,
        });

        // Set the auth session and redirect to the assets page
        context.setSession(authSession);

        // If org exists (SCIM SSO case), redirect to that org
        if (org?.id) {
          return redirect(safeRedirect(redirectTo || "/assets"), {
            headers: [setCookie(await setSelectedOrganizationIdCookie(org.id))],
          });
        }

        // Pure SSO case — check if the SSO user has any team orgs
        // (e.g. from a previous invite). If not, redirect to the pending
        // page so they don't land on a hidden personal workspace.
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
          return redirect("/sso-pending-assignment");
        }

        return redirect(safeRedirect(redirectTo || "/assets"));
      }
    }

    throw notAllowedMethod(method);
  } catch (cause) {
    // The account was moved onto SSO and the person must sign in once more:
    // an outcome to report, not a failure.
    if (isSsoAccountLinkedError(cause)) {
      return data(
        payload({ ssoAccountLinked: true as const, message: cause.message })
      );
    }
    const reason = makeShelfError(cause);
    return data(error(reason), { status: reason.status });
  }
}

export function loader({ context }: LoaderFunctionArgs) {
  const title = "Signing in via SSO";
  const subHeading = "Please wait while we connect your account";

  if (context.isAuthenticated) {
    return redirect("/assets");
  }

  return data(payload({ title, subHeading }));
}

export const meta: MetaFunction<typeof loader> = ({ data }) => [
  { title: data ? appendToMetaTitle(data.title) : "" },
];

export default function LoginCallback() {
  const fetcher = useFetcher<typeof action>();
  const { data } = fetcher;
  const [searchParams] = useSearchParams();
  const redirectTo = searchParams.get("redirectTo") ?? "/assets";

  useEffect(() => {
    const {
      data: { subscription },
    } = supabaseClient.auth.onAuthStateChange((event, supabaseSession) => {
      if (event === "SIGNED_IN") {
        // supabase sdk has ability to read url fragment that contains your token after third party provider redirects you here
        // this fragment url looks like https://.....#access_token=evxxxxxxxx&refresh_token=xxxxxx, and it's not readable server-side (Oauth security)
        // supabase auth listener gives us a user session, based on what it founds in this fragment url
        // we can't use it directly, client-side, because we can't access sessionStorage from here

        // we should not trust what's happen client side
        // so, we only pick the refresh token, and let's back-end getting user session from it
        const refreshToken = supabaseSession?.refresh_token;

        if (!refreshToken) return;

        const formData = createSSOFormData(refreshToken, redirectTo);

        void fetcher.submit(formData, { method: "post" });
      }
    });

    return () => {
      // prevent memory leak. Listener stays alive 👨‍🎤
      subscription.unsubscribe();
    };
  }, [fetcher, redirectTo]);

  const validationErrors = useMemo(
    () => data?.error?.additionalData?.validationErrors,
    [data?.error]
  );

  const linkedNotice =
    data && "ssoAccountLinked" in data && data.ssoAccountLinked
      ? data.message
      : null;

  return (
    <div className="flex justify-center text-center">
      {linkedNotice ? (
        <SsoAccountLinkedNotice variant="web" />
      ) : data?.error ? (
        <div>
          {/* If there are validation errors, we map over those and show them */}
          {validationErrors ? (
            Object.values(validationErrors).map((error) => (
              <div className="text-sm text-error-500" key={error.message}>
                {error.message}
              </div>
            ))
          ) : (
            // If there are no validation errors, we show the error message returned by the catch in the action
            <div className="text-sm text-error-500">{data.error.message}</div>
          )}
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
