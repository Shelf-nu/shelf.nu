import { useEffect } from "react";

import type { ActionFunctionArgs, MetaFunction } from "react-router";
import { data, useFetcher } from "react-router";
import { z } from "zod";
import { Button } from "~/components/shared/button";
import { Spinner } from "~/components/shared/spinner";
import { config } from "~/config/shelf.config";
import { supabaseClient } from "~/integrations/supabase/client";
import { createMobileAuthCode } from "~/modules/auth/mobile-sso.server";
import { refreshAccessToken } from "~/modules/auth/service.server";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";
import { createSSOFormData } from "~/utils/auth";
import { makeShelfError, notAllowedMethod, ShelfError } from "~/utils/error";
import { getActionMethod, parseData, payload } from "~/utils/http.server";
import { resolveUserAndOrgForSsoCallback } from "~/utils/sso.server";

/**
 * Mobile SSO callback (native-app web-delegated auth).
 *
 * Supabase redirects here (instead of `/oauth/callback`) after it validates the
 * SAML assertion for a `platform=mobile` SSO sign-in. SSO completion is
 * identical to the web callback — user/org provisioning + SCIM linking via
 * `resolveUserAndOrgForSsoCallback` — except that instead of establishing a web
 * session we mint a single-use authorization code and hand it back to the app
 * through the `shelf://auth-callback?code=…` deeplink. The app then redeems the
 * code at `POST /api/mobile/exchange` for a fresh, independent session.
 *
 * No tokens ever appear in the deeplink — only the short-lived, single-use code.
 *
 * @see apps/webapp/app/modules/auth/mobile-sso.server.ts
 * @see apps/webapp/app/routes/api+/mobile+/exchange.ts
 * @see apps/webapp/app/routes/_auth+/oauth.callback.tsx — web counterpart
 */

/** Custom-scheme deeplink the companion app registers and listens for. */
const MOBILE_CALLBACK_URL = "shelf://auth-callback";

/**
 * Mirrors the web callback's payload: the client reads the Supabase session
 * from the URL fragment and posts the refresh token + SAML claims. We re-derive
 * the session server-side and never trust the client-supplied tokens.
 */
const MobileCallbackSchema = z.object({
  firstName: z.string().min(1, "First name is required"),
  lastName: z.string().min(1, "Last name is required"),
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
  // `createSSOFormData` always includes a redirectTo; it is unused on mobile.
  redirectTo: z.string().optional(),
  phone: z.string().optional(),
  streetAddress: z.string().optional(),
  city: z.string().optional(),
  stateProvince: z.string().optional(),
  postalCode: z.string().optional(),
  country: z.string().optional(),
});

export async function action({ request }: ActionFunctionArgs) {
  const { disableSSO } = config;
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
        const {
          refreshToken,
          firstName,
          lastName,
          groups,
          phone,
          streetAddress,
          city,
          stateProvince,
          postalCode,
          country,
        } = parseData(await request.formData(), MobileCallbackSchema);

        // Don't trust client tokens — re-derive the session from the refresh
        // token server-side (same trust boundary as the web callback).
        const authSession = await refreshAccessToken(refreshToken);

        const contactInfo = {
          phone,
          street: streetAddress,
          city,
          stateProvince,
          zipPostalCode: postalCode,
          countryRegion: country,
        };

        // Provision the user/org exactly as the web flow does (creates the user
        // on first login, links SCIM groups). The app's bearer-auth API looks
        // the user up by email, so this must run before we mint a code.
        await resolveUserAndOrgForSsoCallback({
          authSession,
          firstName,
          lastName,
          groups,
          contactInfo,
        });

        // Hand the device a single-use code via the deeplink — never tokens.
        const code = await createMobileAuthCode(authSession.userId);

        return data(
          payload({
            deeplink: `${MOBILE_CALLBACK_URL}?code=${encodeURIComponent(code)}`,
          })
        );
      }
    }

    throw notAllowedMethod(method);
  } catch (cause) {
    const reason = makeShelfError(cause);
    return data(
      { error: { message: reason.message } },
      { status: reason.status }
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
  const result = fetcher.data;

  useEffect(() => {
    const {
      data: { subscription },
    } = supabaseClient.auth.onAuthStateChange((event, supabaseSession) => {
      if (event === "SIGNED_IN") {
        // Supabase reads the session from the URL fragment (client-only). We
        // forward only the refresh token; the action re-derives the session.
        const refreshToken = supabaseSession?.refresh_token;
        if (!refreshToken) return;

        const formData = createSSOFormData(supabaseSession, refreshToken, "");
        void fetcher.submit(formData, { method: "post" });
      }
    });

    return () => {
      subscription.unsubscribe();
    };
  }, [fetcher]);

  // Once the server returns the deeplink, bounce back into the app. In the
  // system browser opened by `expo-web-browser`, navigating to the `shelf://`
  // scheme closes the auth session and returns the code to the app.
  useEffect(() => {
    if (result && "deeplink" in result && result.deeplink) {
      window.location.href = result.deeplink;
    }
  }, [result]);

  const errorMessage =
    result && "error" in result ? result.error?.message : undefined;

  return (
    <div className="flex justify-center text-center">
      {errorMessage ? (
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
