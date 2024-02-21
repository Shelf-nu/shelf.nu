import { redirect } from "react-router";

/** We dont render anything on /settings
 * We just redirect to default subroute which is user
 */
export async function loader() {
  return redirect("account");
}

export const shouldRevalidate = () => false;
