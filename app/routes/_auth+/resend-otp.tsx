import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { z } from "zod";
import { sendOTP } from "~/modules/auth/service.server";
import { makeShelfError, notAllowedMethod } from "~/utils/error";

import { data, error, getActionMethod, parseData } from "~/utils/http.server";
import { validEmail } from "~/utils/misc";

export async function action({ request }: ActionFunctionArgs) {
  try {
    const method = getActionMethod(request);

    switch (method) {
      case "POST": {
        const { email } = parseData(
          await request.formData(),
          z.object({
            email: z
              .string()
              .transform((email) => email.toLowerCase())
              .refine(validEmail, () => ({
                message: "Please enter a valid email",
              })),
          })
        );

        await sendOTP(email);
        return json(data({ success: true }));
      }
    }

    throw notAllowedMethod(method);
  } catch (cause) {
    //@ts-expect-error
    const isRateLimitError = cause.code === "over_email_send_rate_limit";

    const reason = makeShelfError(cause, {}, !isRateLimitError);
    return json(error(reason), { status: reason.status });
  }
}
