import type {
  ActionFunctionArgs,
  LoaderFunctionArgs,
  MetaFunction,
} from "react-router";
import {
  data,
  redirect,
  Form,
  useActionData,
  useLoaderData,
  useNavigation,
} from "react-router";
import { useZorm } from "react-zorm";
import { z } from "zod";
import Input from "~/components/forms/input";
import { Button } from "~/components/shared/button";
import { config } from "~/config/shelf.config";
import { useSearchParams } from "~/hooks/search-params";
import { useAutoFocus } from "~/hooks/use-auto-focus";
import { startSsoSignIn } from "~/modules/auth/sso-pkce.server";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";
import { getClientIpFromHeaders } from "~/utils/client-ip.server";
import {
  mobilePkceChallengeCookie,
  setSsoCodeVerifier,
} from "~/utils/cookies.server";
import { DEFAULT_SSO_DOMAIN } from "~/utils/env";
import { makeShelfError, notAllowedMethod, ShelfError } from "~/utils/error";
import { isFormProcessing } from "~/utils/form";
import {
  payload,
  error,
  getActionMethod,
  parseData,
} from "~/utils/http.server";
import { isValidDomain } from "~/utils/misc";

const SSOLoginFormSchema = z.object({
  domain: z
    .string()
    .transform((email) => email.toLowerCase())
    .refine(isValidDomain, () => ({
      message: "Please enter a valid domain name",
    })),
  redirectTo: z.string().optional(),
  // "mobile" routes the post-auth redirect to the native-app callback so the
  // companion app can complete SSO login (see startSsoSignIn).
  platform: z.enum(["web", "mobile"]).optional(),
});

export async function loader({ context, request }: LoaderFunctionArgs) {
  const { disableSSO, oidc } = config;
  const title = "Log in with SSO";
  // With SAML SSO switched off the page shows the OIDC button only.
  const subHeading = disableSSO
    ? "Use single sign-on to log in."
    : "Enter your company's domain to login with SSO.";

  const url = new URL(request.url);
  // The native-app flow opens this page with `?platform=mobile`. The in-app
  // browser may carry a stale web cookie, but the app still needs to complete
  // the SSO handoff to obtain its OWN session — so don't short-circuit it to
  // /assets. The web flow still redirects an already-authenticated session.
  const isMobile = url.searchParams.get("platform") === "mobile";

  try {
    if (context.isAuthenticated && !isMobile) {
      return redirect("/");
    }

    // The page hosts both SSO methods, so it closes only when neither is on.
    if (disableSSO && !oidc.enabled) {
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

    // PKCE (native SSO): the companion appends an S256 `code_challenge`. Stash
    // it in a short-lived cookie so it survives the SSO redirect chain back to
    // `/oauth/callback/mobile`, where it is bound to the minted auth code.
    const codeChallenge = url.searchParams.get("code_challenge");
    const validChallenge =
      codeChallenge && /^[A-Za-z0-9_-]{43}$/.test(codeChallenge)
        ? codeChallenge
        : null;

    // A mobile flow MUST carry a well-formed challenge. The native callback
    // hands the auth code back over the `shelf://` custom scheme, which any app
    // on the device may claim, so an unbound code would be a bearer token for a
    // full session (RFC 8252 §8.1). Refuse rather than degrade: a request
    // without one cannot have come from the companion, which always sends it.
    if (isMobile && !validChallenge) {
      throw new ShelfError({
        cause: null,
        title: "Sign-in not supported",
        message:
          "This version of the Shelf app can't sign in with SSO. Please update the app and try again.",
        label: "Auth",
        status: 400,
        shouldBeCaptured: false,
      });
    }

    if (isMobile && validChallenge) {
      return data(payload({ title, subHeading, disableSSO, oidc }), {
        headers: {
          "Set-Cookie":
            await mobilePkceChallengeCookie.serialize(validChallenge),
        },
      });
    }

    // With only the OIDC login available there is nothing to choose on this
    // page, so the web flow goes straight to the identity provider.
    if (disableSSO && !isMobile) {
      return redirect("/oidc-login");
    }

    // If a default SSO domain is configured, skip the domain input form and
    // redirect straight to the identity provider. Guarded to web only: mobile
    // (PKCE) requests are handled above and must complete their own handoff,
    // so they should not be short-circuited into the web SSO redirect.
    if (DEFAULT_SSO_DOMAIN && !isMobile) {
      const { url, codeVerifier } = await startSsoSignIn(DEFAULT_SSO_DOMAIN, {
        clientIp: getClientIpFromHeaders(request.headers),
      });
      return redirect(url, {
        headers: { "Set-Cookie": await setSsoCodeVerifier(codeVerifier) },
      });
    }

    return payload({ title, subHeading, disableSSO, oidc });
  } catch (cause) {
    const reason = makeShelfError(cause);
    throw data(error(reason), { status: reason.status });
  }
}

export async function action({ request }: ActionFunctionArgs) {
  try {
    const method = getActionMethod(request);

    switch (method) {
      case "POST": {
        // The domain form is the SAML SSO; the OIDC login does not post here.
        if (config.disableSSO) {
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

        const { domain, platform } = parseData(
          await request.formData(),
          SSOLoginFormSchema,
          { shouldBeCaptured: false }
        );
        const { url, codeVerifier } = await startSsoSignIn(domain, {
          platform,
          clientIp: getClientIpFromHeaders(request.headers),
        });

        // The callback can only trade Supabase's code for a session with this
        // verifier, so only this browser can finish the sign-in.
        return redirect(url, {
          headers: { "Set-Cookie": await setSsoCodeVerifier(codeVerifier) },
        });
      }
    }

    throw notAllowedMethod(method);
  } catch (cause) {
    const reason = makeShelfError(cause);
    return data(error(reason), { status: reason.status });
  }
}

export const meta: MetaFunction<typeof loader> = ({ data }) => [
  { title: data ? appendToMetaTitle(data.title) : "" },
];

export default function SSOLogin() {
  const { disableSSO, oidc } = useLoaderData<typeof loader>();
  const zo = useZorm("NewQuestionWizardScreen", SSOLoginFormSchema);
  const navigation = useNavigation();
  const disabled = isFormProcessing(navigation.state);
  const data = useActionData<typeof action>();
  const [searchParams] = useSearchParams();
  // Native-app SSO opens this page with `?platform=mobile`; forward it so the
  // action targets the mobile callback. Defaults to web for the normal flow.
  const platform = searchParams.get("platform") === "mobile" ? "mobile" : "web";

  /** Focus the domain field on mount (intentional first-field focus on auth pages). */
  const domainInputRef = useAutoFocus<HTMLInputElement>();

  return (
    <>
      <div className="flex flex-col gap-3">
        {oidc.enabled ? (
          // Leaves the app for the identity provider, so it has to be a
          // document navigation. The native-app flow keeps its platform so
          // the login lands on the mobile callback.
          <Button
            to={
              platform === "mobile"
                ? "/oidc-login?platform=mobile"
                : "/oidc-login"
            }
            reloadDocument
            variant={disableSSO ? "primary" : "secondary"}
            width="full"
            data-test-id="oidcLogin"
          >
            {oidc.buttonLabel}
          </Button>
        ) : null}
        {disableSSO ? null : (
          <Form method="post" ref={zo.ref}>
            {/* Forwarded so the action can target the native-app callback. */}
            <input type="hidden" name="platform" value={platform} />
            <div className="flex flex-col gap-3">
              <Input
                ref={domainInputRef}
                data-test-id="domain"
                label="Company domain"
                placeholder="yourdomain.com"
                required
                name={zo.fields.domain()}
                type="text"
                autoComplete="domain"
                disabled={disabled}
                inputClassName="w-full"
                error={zo.errors.domain()?.message}
              />
              <Button
                className="text-center"
                type="submit"
                data-test-id="login"
                disabled={disabled}
                width="full"
              >
                Log In
              </Button>
            </div>
          </Form>
        )}
        {data?.error?.message && (
          <div className="text-sm text-error-500">{data.error.message}</div>
        )}
        {/* Installed as an app (PWA) there is no browser back button, so the
            page links back to password login itself. Hidden for the native
            app: its sign-in sheet has its own Cancel, and /login inside that
            sheet could not sign the app in. */}
        {platform === "web" ? (
          <div className="pt-4 text-center">
            <Button variant="link" to="/login">
              Back to login
            </Button>
          </div>
        ) : null}
        <div>
          Want to enable SSO for your organization?{" "}
          <Button
            as="a"
            href="mailto:hello@shelf.nu?subject=SSO request"
            variant="link"
          >
            Contact us
          </Button>
        </div>
      </div>
    </>
  );
}
