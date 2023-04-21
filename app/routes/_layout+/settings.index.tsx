import type { LoaderArgs } from "@remix-run/server-runtime";
import { redirect } from "react-router";
import { requireAuthSession } from "~/modules/auth";

/** We dont render anything on /settings
 * We just redirect to default subroute which is user
 */
export async function loader({ request }: LoaderArgs) {
  await requireAuthSession(request);

  return redirect("user");
}

export const shouldRevalidate = () => false;
