import type { ActionFunctionArgs } from "react-router";
import { data, redirect } from "react-router";

import { SendOtpSchema } from "~/modules/auth/components/continue-with-email-form";
import { assertEmailLoginEnabled } from "~/modules/auth/email-login.server";
import { sendOTP } from "~/modules/auth/service.server";
import { refreshSignupIntentHeaders } from "~/modules/signup-intent/cookie.server";
import { makeShelfError, notAllowedMethod } from "~/utils/error";
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

        // No code of any kind while email login is off: a signup code would
        // open an account that cannot sign in again. `sendOTP` refuses too;
        // asking here keeps the signup checks below from running first.
        assertEmailLoginEnabled();

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
