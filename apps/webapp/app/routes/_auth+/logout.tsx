import type { ActionFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { z } from "zod";

import { expireListPreferenceCookies } from "~/utils/cookies.server";
import { assertIsPost, parseData } from "~/utils/http.server";

export async function action({ context, request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { redirectTo } = parseData(
    await request.formData(),
    z.object({
      redirectTo: z.string().optional(),
    })
  );

  context.destroySession();
  // The next person on this browser starts with clean lists.
  return redirect(redirectTo || "/login", {
    headers: await expireListPreferenceCookies(request),
  });
}

export function loader() {
  return redirect("/");
}
