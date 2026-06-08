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
  useNavigation,
} from "react-router";
import { useZorm } from "react-zorm";
import { z } from "zod";
import Input from "~/components/forms/input";
import { Button } from "~/components/shared/button";
import { config } from "~/config/shelf.config";
import { useSearchParams } from "~/hooks/search-params";
import { useAutoFocus } from "~/hooks/use-auto-focus";
import { signInWithSSO } from "~/modules/auth/service.server";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";
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
  // companion app can complete SSO login (see signInWithSSO).
  platform: z.enum(["web", "mobile"]).optional(),
});

export function loader({ context, request }: LoaderFunctionArgs) {
  const title = "Log in with SSO";
  const subHeading = "Enter your company's domain to login with SSO.";
  const { disableSSO } = config;

  // The native-app flow opens this page with `?platform=mobile`. The in-app
  // browser may carry a stale web cookie, but the app still needs to complete
  // the SSO handoff to obtain its OWN session — so don't short-circuit it to
  // /assets. The web flow still redirects an already-authenticated session.
  const isMobile =
    new URL(request.url).searchParams.get("platform") === "mobile";

  try {
    if (context.isAuthenticated && !isMobile) {
      return redirect("/assets");
    }

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

    return payload({ title, subHeading });
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
        const { domain, platform } = parseData(
          await request.formData(),
          SSOLoginFormSchema,
          { shouldBeCaptured: false }
        );
        const url = await signInWithSSO(domain, { platform });

        return redirect(url);
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
        {data?.error?.message && (
          <div className="text-sm text-error-500">{data.error.message}</div>
        )}
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
