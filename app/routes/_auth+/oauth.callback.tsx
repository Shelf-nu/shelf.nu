import { useEffect, useState } from "react";

import { json, redirect } from "@remix-run/node";
import type { LoaderFunctionArgs, ActionFunctionArgs } from "@remix-run/node";
import { useActionData, useFetcher, useSearchParams } from "@remix-run/react";
import { parseFormAny } from "react-zorm";
import { z } from "zod";

import { Button } from "~/components/shared";
import { Spinner } from "~/components/shared/spinner";
import { supabaseClient } from "~/integrations/supabase";
import {
  refreshAccessToken,
  commitAuthSession,
  getAuthSession,
} from "~/modules/auth";
import { getOrganizationByUserId } from "~/modules/organization";
import { setSelectedOrganizationIdCookie } from "~/modules/organization/context.server";
import { tryCreateUser, getUserByEmail } from "~/modules/user";
import { assertIsPost, randomUsernameFromEmail, safeRedirect } from "~/utils";
import { setCookie } from "~/utils/cookies.server";

// imagine a user go back after OAuth login success or type this URL
// we don't want him to fall in a black hole 👽
export async function loader({ request }: LoaderFunctionArgs) {
  const authSession = await getAuthSession(request);

  if (authSession) return redirect("/");

  return json({});
}

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);

  const formData = await request.formData();
  const result = await z
    .object({
      refreshToken: z.string(),
      redirectTo: z.string().optional(),
    })
    .safeParseAsync(parseFormAny(formData));

  if (!result.success) {
    return json(
      {
        message: "invalid-request",
      },
      { status: 400 }
    );
  }

  const { redirectTo, refreshToken } = result.data;
  const safeRedirectTo = safeRedirect(redirectTo, "/");

  // We should not trust what is sent from the client
  // https://github.com/rphlmr/supa-fly-stack/issues/45
  const authSession = await refreshAccessToken(refreshToken);

  if (!authSession) {
    return json(
      {
        message: "invalid-refresh-token",
      },
      { status: 401 }
    );
  }

  // user have an account, skip creation part and just commit session
  if (await getUserByEmail(authSession.email)) {
    const personalOrganization = await getOrganizationByUserId({
      userId: authSession.userId,
      orgType: "PERSONAL",
    });

    return redirect(safeRedirectTo, {
      headers: [
        setCookie(
          await setSelectedOrganizationIdCookie(personalOrganization.id)
        ),
        setCookie(
          await commitAuthSession(request, {
            authSession,
          })
        ),
      ],
    });
  }
  const username = randomUsernameFromEmail(authSession.email);

  // first time sign in, let's create a brand-new User row in supabase
  const user = await tryCreateUser({ ...authSession, username });

  if (!user) {
    return json(
      {
        message: "create-user-error",
      },
      { status: 500 }
    );
  }

  const personalOrganization = user.organizations[0];

  return redirect(safeRedirectTo, {
    headers: [
      setCookie(await setSelectedOrganizationIdCookie(personalOrganization.id)),
      setCookie(
        await commitAuthSession(request, {
          authSession,
        })
      ),
    ],
  });
}

export default function LoginCallback() {
  const error = useActionData<typeof action>();
  const [clientError, setClientError] = useState("");
  const fetcher = useFetcher();
  const [searchParams] = useSearchParams();
  const redirectTo = searchParams.get("redirectTo") ?? "/";

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

        const formData = new FormData();

        formData.append("refreshToken", refreshToken);
        formData.append("redirectTo", redirectTo);

        fetcher.submit(formData, { method: "post" });
      }
    });

    return () => {
      // prevent memory leak. Listener stays alive 👨‍🎤
      subscription.unsubscribe();
    };
  }, [fetcher, redirectTo]);

  useEffect(() => {
    if (window?.location?.hash) {
      /**
       * We check the hash fragment of the url as this is what suaabase uses to return an error
       * If it exists, we update the clientError state with it
       * */
      const parsedHash = new URLSearchParams(window.location.hash.substring(1));

      const error = parsedHash.get("error_description");

      if (error && error !== "") {
        setClientError(() => error);
      }
    }
  }, []);

  if (error) return <div className="text-center">{error.message}</div>;
  if (clientError)
    return (
      <div className="text-center">
        <h3 className="font-medium">{clientError}.</h3>
        <Button variant="link" to="/join?resend">
          Resend confirmation link
        </Button>
        <p>If the issue persists please get in touch with the Shelf</p>
        team.{" "}
      </div>
    );
  return (
    <div className="flex flex-col items-center text-center">
      <Spinner />
      <p className="mt-2">Attempting to login...</p>
    </div>
  );
}
