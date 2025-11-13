import { useEffect, useMemo } from "react";

import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { data, redirect , useFetcher } from "react-router";
import { z } from "zod";
import { Button } from "~/components/shared/button";
import { Spinner } from "~/components/shared/spinner";
import { config } from "~/config/shelf.config";
import { useSearchParams } from "~/hooks/search-params";
import { supabaseClient } from "~/integrations/supabase/client";
import { refreshAccessToken } from "~/modules/auth/service.server";
import { setSelectedOrganizationIdCookie } from "~/modules/organization/context.server";
import { createSSOFormData } from "~/utils/auth";
import { setCookie } from "~/utils/cookies.server";
import { makeShelfError, notAllowedMethod, ShelfError } from "~/utils/error";
import {
  payload,
  error,
  getActionMethod,
  parseData,
  safeRedirect,
} from "~/utils/http.server";
import { resolveUserAndOrgForSsoCallback } from "~/utils/sso.server";

/**
 * Schema for handling OAuth callback data with improved groups handling
 * Ensures groups are always an array or empty array, regardless of input format
 */
const CallbackSchema = z.object({
  firstName: z.string().min(1, "First name is required"),
  lastName: z.string().min(1, "Last name is required"),
  // Transform groups to either parse JSON string array or return empty array
  groups: z
    .union([
      z.string().transform((str) => {
        try {
          const parsed = JSON.parse(str);
          return Array.isArray(parsed) ? parsed : [];
        } catch {
          return [];
        }
      }),
      z.array(z.string()),
    ])
    .default([]),
  refreshToken: z.string().min(1),
  redirectTo: z.string().optional(),
  // Contact information fields
  phone: z.string().optional(),
  streetAddress: z.string().optional(),
  city: z.string().optional(),
  stateProvince: z.string().optional(),
  postalCode: z.string().optional(),
  country: z.string().optional(),
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
        const {
          refreshToken,
          redirectTo,
          firstName,
          lastName,
          groups,
          phone,
          streetAddress,
          city,
          stateProvince,
          postalCode,
          country,
        } = parseData(await request.formData(), CallbackSchema);

        // We should not trust what is sent from the client
        // https://github.com/rphlmr/supa-fly-stack/issues/45
        const authSession = await refreshAccessToken(refreshToken);
        // Package contact information
        const contactInfo = {
          phone,
          street: streetAddress, // Map to our field name
          city,
          stateProvince,
          zipPostalCode: postalCode, // Map to our field name
          countryRegion: country, // Map to our field name
        };

        /**
         * This resolves the correct org we should redirect the user to
         * Also it handles:
         * - Creating a new user if the user doesn't exist
         * - Throwing an error if the user is already connected to an email account
         * - Linking the user to the correct org if SCIM is configured
         */
        const { org } = await resolveUserAndOrgForSsoCallback({
          authSession,
          firstName,
          lastName,
          groups,
          contactInfo,
        });

        // Set the auth session and redirect to the assets page
        context.setSession(authSession);

        // If org exists (SCIM SSO case), redirect to that org
        // Otherwise (Pure SSO case), redirect to personal workspace
        return redirect(
          safeRedirect(redirectTo || "/assets"),
          org?.id
            ? {
                headers: [
                  setCookie(await setSelectedOrganizationIdCookie(org?.id)),
                ],
              }
            : {}
        );
      }
    }

    throw notAllowedMethod(method);
  } catch (cause) {
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

  return payload({ title, subHeading });
}
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

        const formData = createSSOFormData(
          supabaseSession,
          refreshToken,
          redirectTo
        );

        fetcher.submit(formData, { method: "post" });
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

  return (
    <div className="flex justify-center text-center">
      {data?.error ? (
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
