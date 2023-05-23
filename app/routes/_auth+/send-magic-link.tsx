import type { ActionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { parseFormAny } from "react-zorm";
import { z } from "zod";

import { sendMagicLink } from "~/modules/auth";
import { assertIsPost } from "~/utils/http.server";

export async function action({ request }: ActionArgs) {
  assertIsPost(request);

  const formData = await request.formData();
  const result = await z
    .object({
      email: z
        .string()
        .email("Please enter a valid email.")
        .transform((email) => email.toLowerCase()),
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

  const { error } = await sendMagicLink(result.data.email);

  if (error) {
    return json(
      {
        error: "Unable to send magic link. Please try again later. If the issue persists, contact support.",
      },
      { status: 500 }
    );
  }

  return json({ error: null });
}
