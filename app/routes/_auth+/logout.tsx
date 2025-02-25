import type { ActionFunctionArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";
import { z } from "zod";

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
  return redirect(redirectTo || "/login");
}

export function loader() {
  return redirect("/");
}
