import type { ActionFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";

import { sendOTP, SendOtpSchema } from "~/modules/auth";
import { makeShelfError, error, notAllowedMethod } from "~/utils";
import { getActionMethod, parseData } from "~/utils/http.server";

export async function action({ request }: ActionFunctionArgs) {
  try {
    const method = getActionMethod(request);

    switch (method) {
      case "POST": {
        const { email, mode } = parseData(
          await request.formData(),
          SendOtpSchema
        );

        await sendOTP(email);

        return redirect(`/otp?email=${encodeURIComponent(email)}&mode=${mode}`);
      }
    }

    throw notAllowedMethod(method);
  } catch (cause) {
    const reason = makeShelfError(cause);
    return json(error(reason), { status: reason.status });
  }
}
