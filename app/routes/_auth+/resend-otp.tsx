import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { z } from "zod";
import { resendVerificationEmail } from "~/modules/auth/service.server";
import { makeShelfError, notAllowedMethod } from "~/utils/error";

import { error, getActionMethod, parseData } from "~/utils/http.server";
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

        await resendVerificationEmail(email);
      }
    }

    throw notAllowedMethod(method);
  } catch (cause) {
    const reason = makeShelfError(cause);
    return json(error(reason), { status: reason.status });
  }
}
