import type { ActionFunctionArgs } from "@remix-run/node";
import { data, redirect } from "@remix-run/node";

import { SendOtpSchema } from "~/modules/auth/components/continue-with-email-form";
import { sendOTP } from "~/modules/auth/service.server";
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
          SendOtpSchema
        );

        // Only validate SSO for signup attempts
        if (mode === "signup" || mode === "confirm_signup") {
          await validateNonSSOSignup(email);
        }

        await sendOTP(email);

        return redirect(`/otp?email=${encodeURIComponent(email)}&mode=${mode}`);
      }
    }

    throw notAllowedMethod(method);
  } catch (cause) {
    const reason = makeShelfError(cause);
    return data(error(reason), { status: reason.status });
  }
}
