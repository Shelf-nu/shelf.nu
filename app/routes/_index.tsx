import type { LoaderFunctionArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";

import { getAuthSession } from "~/modules/auth";
import { getUserByEmail } from "~/modules/user";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const authSession = await getAuthSession(request);

  const user = authSession
    ? await getUserByEmail(authSession?.email)
    : undefined;

  if (user) {
    return redirect(user.onboarded ? "/assets" : "onboarding");
  }
  return redirect("login");
};
