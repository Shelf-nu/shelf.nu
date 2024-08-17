import { redirect } from "@remix-run/node";

/**
 * We don't render anything on /settings/team/users/$userId
 * We just redirect to default sub-route which is /assets
 */
export function loader() {
  return redirect("assets");
}

export const shouldRevalidate = () => false;
