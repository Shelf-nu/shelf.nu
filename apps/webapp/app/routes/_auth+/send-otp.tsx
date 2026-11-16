import type { ActionFunctionArgs } from "react-router";
import { data, redirect } from "react-router";

import { config } from "~/config/shelf.config";
import { SendOtpSchema } from "~/modules/auth/components/continue-with-email-form";
import { sendOTP } from "~/modules/auth/service.server";
import { refreshSignupIntentHeaders } from "~/modules/signup-intent/cookie.server";
import { makeShelfError, notAllowedMethod, ShelfError } from "~/utils/error";
import { error, getActionMethod, parseData } from "~/utils/http.server";
import { validateNonSSOSignup } from "~/utils/sso.server";

export async function action({ request }: ActionFunctionArgs) {
  try {
    const method = getActionMethod(request);

    switch (method) {
      case "POST": {
        const { email, mode } = parseData(
          await request.formData(),
          SendOtpSchema,
          { shouldBeCaptured: false }
        );

        // A login code is an email login. Signup codes stay governed by
        // DISABLE_SIGNUP, so only the signup modes pass. `mode` is optional,
        // and a request without one asks for a login code.
        const isSignupMode = mode === "signup" || mode === "confirm_signup";
        if (config.disableEmailLogin && !isSignupMode) {
          throw new ShelfError({
            cause: null,
            title: "Email login is disabled",
            message:
              "Signing in with a one-time code is disabled. Please use single sign-on.",
            label: "Auth",
            status: 403,
            shouldBeCaptured: false,
          });
        }

        // Only validate SSO for signup attempts
        if (mode === "signup" || mode === "confirm_signup") {
          await validateNonSSOSignup(email);
        }

        await sendOTP(email);

        return redirect(
          `/otp?email=${encodeURIComponent(email)}&mode=${mode}`,
          {
            // Carry the signup link's intent (if any) on to the code step.
            // A login is not a signup, so it carries nothing.
            headers:
              mode === "login" ? [] : await refreshSignupIntentHeaders(request),
          }
        );
      }
    }

    throw notAllowedMethod(method);
  } catch (cause) {
    const reason = makeShelfError(cause);
    return data(error(reason), { status: reason.status });
  }
}
