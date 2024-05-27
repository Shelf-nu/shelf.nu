import { useEffect } from "react";

import { json, redirect } from "@remix-run/node";
import type { ActionFunctionArgs } from "@remix-run/node";
import { useActionData, useFetcher, useSearchParams } from "@remix-run/react";
import { z } from "zod";
import { db } from "~/database/db.server";
import { supabaseClient } from "~/integrations/supabase/client";
import { refreshAccessToken } from "~/modules/auth/service.server";
import { setSelectedOrganizationIdCookie } from "~/modules/organization/context.server";
import { createUserFromSSO } from "~/modules/user/service.server";
import { setCookie } from "~/utils/cookies.server";
import { makeShelfError, notAllowedMethod } from "~/utils/error";
import {
  error,
  getActionMethod,
  parseData,
  safeRedirect,
} from "~/utils/http.server";

export async function action({ request, context }: ActionFunctionArgs) {
  try {
    const method = getActionMethod(request);

    switch (method) {
      case "POST": {
        const { refreshToken, redirectTo, firstName, lastName } = parseData(
          await request.formData(),
          z.object({
            firstName: z.string(),
            lastName: z.string(),
            refreshToken: z.string(),
            redirectTo: z.string().optional(),
          })
        );

        // We should not trust what is sent from the client
        // https://github.com/rphlmr/supa-fly-stack/issues/45
        const authSession = await refreshAccessToken(refreshToken);

        /**
         * Cases we should handle:
         * - [x] Auth Account & User exists in our database - we just login the user
         * - [x] Auth Account exists but User doesn't exist in our database - we create a new user connecting it to authUser and login the user
         * - [ ] Auth Account(SSO version) doesn't exist but User exists in our database - we create a new authUser connecting it to user and login the user
         */

        /**
         * Check if there is an existing user related to this auth session
         */
        let user = await db.user.findUnique({
          where: {
            id: authSession.userId,
          },
          include: {
            organizations: true,
          },
        });

        if (!user) {
          user = await createUserFromSSO(authSession, {
            firstName,
            lastName,
          });
        }
        // Set the auth session and redirect to the assets page
        context.setSession(authSession);

        return redirect(safeRedirect(redirectTo || "/assets"), {
          headers: [
            setCookie(
              await setSelectedOrganizationIdCookie(user.organizations[0].id)
            ),
          ],
        });
      }
    }

    throw notAllowedMethod(method);
  } catch (cause) {
    const reason = makeShelfError(cause);
    return json(error(reason), { status: reason.status });
  }
}

export default function LoginCallback() {
  const data = useActionData<typeof action>();
  const fetcher = useFetcher();
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

        fetcher.submit(formData, { method: "post" });
      }
    });

    return () => {
      // prevent memory leak. Listener stays alive 👨‍🎤
      subscription.unsubscribe();
    };
  }, [fetcher, redirectTo]);

  // @TODO here we need to add some nice UI
  return data?.error ? <div>{data.error.message}</div> : null;
}
