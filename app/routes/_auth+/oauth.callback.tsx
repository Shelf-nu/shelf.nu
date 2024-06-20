import { useEffect, useMemo } from "react";

import { json, redirect } from "@remix-run/node";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { useFetcher, useSearchParams } from "@remix-run/react";
import { z } from "zod";
import { Button } from "~/components/shared/button";
import { Spinner } from "~/components/shared/spinner";
import { supabaseClient } from "~/integrations/supabase/client";
import { refreshAccessToken } from "~/modules/auth/service.server";
import { setSelectedOrganizationIdCookie } from "~/modules/organization/context.server";
import { setCookie } from "~/utils/cookies.server";
import { makeShelfError, notAllowedMethod } from "~/utils/error";
import {
  data,
  error,
  getActionMethod,
  parseData,
  safeRedirect,
} from "~/utils/http.server";
import { resolveUserAndOrgForSsoCallback } from "~/utils/sso.server";
import { stringToJSONSchema } from "~/utils/zod";

export async function action({ request, context }: ActionFunctionArgs) {
  try {
    const method = getActionMethod(request);

    switch (method) {
      case "POST": {
        const { refreshToken, redirectTo, firstName, lastName, groups } =
          parseData(
            await request.formData(),
            z.object({
              firstName: z.string().min(1),
              lastName: z.string().min(1),
              groups: stringToJSONSchema.pipe(
                z
                  .array(z.string())
                  .nonempty(
                    "User doesn't belong to any group. Groups are required for assigning the correct workspaces and permissions."
                  )
              ),
              refreshToken: z.string().min(1),
              redirectTo: z.string().optional(),
            })
          );

        // We should not trust what is sent from the client
        // https://github.com/rphlmr/supa-fly-stack/issues/45
        const authSession = await refreshAccessToken(refreshToken);

        /**
         * This resolves the correct org we should redirec the user to
         * Also it handles:
         * - Creating a new user if the user doesn't exist
         * - Throwing an error if the user is already connected to an email account
         * - Linking the user to the correct org
         */
        const { org } = await resolveUserAndOrgForSsoCallback({
          authSession,
          firstName,
          lastName,
          groups,
        });
        // Set the auth session and redirect to the assets page
        context.setSession(authSession);

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
    return json(error(reason), { status: reason.status });
  }
}

export function loader({ context }: LoaderFunctionArgs) {
  const title = "Signing in via SSO";
  const subHeading = "Please wait while we connect your account";

  if (context.isAuthenticated) {
    return redirect("/assets");
  }

  return json(data({ title, subHeading }));
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
        const user = supabaseSession?.user;

        if (!refreshToken) return;

        const formData = new FormData();

        formData.append("refreshToken", refreshToken);
        formData.append("redirectTo", redirectTo);
        formData.append(
          "firstName",
          user?.user_metadata?.custom_claims.firstName || ""
        );
        formData.append(
          "lastName",
          user?.user_metadata?.custom_claims.lastName || ""
        );

        const groups = user?.user_metadata?.custom_claims.groups || [];
        formData.append("groups", JSON.stringify(groups));

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
