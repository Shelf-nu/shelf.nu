import type { ActionFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { z } from "zod";

import { sendOTP } from "~/modules/auth";
import { makeShelfError, validEmail, error, notAllowedMethod } from "~/utils";
import { getActionMethod, parseData } from "~/utils/http.server";

export async function action({ request }: ActionFunctionArgs) {
  try {
    const method = getActionMethod(request);

    switch (method) {
      case "POST": {
        const { email, mode } = parseData(
          await request.formData(),
          z.object({
            /**
             * .email() has an issue with validating email
             * addresses where the there is a subdomain and a dash included:
             * https://github.com/colinhacks/zod/pull/2157
             * So we use the custom validation
             *  */
            email: z
              .string()
              .transform((email) => email.toLowerCase())
              .refine(validEmail, () => ({
                message: "Please enter a valid email",
              })),
            mode: z.enum(["login", "signup", "confirm_signup"]).optional(),
          })
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
