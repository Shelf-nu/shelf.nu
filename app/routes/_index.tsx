import type { LoaderArgs, LoaderFunction } from "@remix-run/node";
import { redirect } from "@remix-run/node";

import { getAuthSession } from "~/modules/auth";
import { getUserByEmail } from "~/modules/user";

export const loader: LoaderFunction = async ({ request }: LoaderArgs) => {
  const authSession = await getAuthSession(request);

  const user = authSession
    ? await getUserByEmail(authSession?.email)
    : undefined;

  if (user) {
    return redirect("items");
  }
  return redirect("login");
};
