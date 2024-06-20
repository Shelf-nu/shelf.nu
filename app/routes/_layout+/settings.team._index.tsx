import { redirect } from "@remix-run/node";

/**
 * We are not going to render anything on /settings/team route
 * instead we are going to redirect user to /settings/team/users
 */
export function loader() {
  return redirect("users");
}

export const shouldRevalidate = () => false;
