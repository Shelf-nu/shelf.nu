import type { ActionFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { parseFormAny } from "react-zorm";
import { z } from "zod";
import { resendVerificationEmail } from "~/modules/auth/service.server";

import { validEmail } from "~/utils";
import { assertIsPost } from "~/utils/http.server";

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);

  const formData = await request.formData();
  const result = await z
    .object({
      email: z
        .string()
        .transform((email) => email.toLowerCase())
        .refine(validEmail, () => ({
          message: "Please enter a valid email",
        })),
    })
    .safeParseAsync(parseFormAny(formData));

  if (!result.success) {
    return json(
      {
        error: "Please enter a valid email.",
      },
      { status: 400 }
    );
  }

  const { status, error, message } = await resendVerificationEmail(
    result.data.email
  );

  if (status === "success") {
    // Assuming you want to redirect to a success page after resending the email.
    return redirect("/confirmation-email-sent");
  } else {
    return json(
      {
        error: error || "Something went wrong. Please try again.",
        message: message || "",
      },
      { status: 500 }
    );
  }
}
