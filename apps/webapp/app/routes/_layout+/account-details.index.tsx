import { redirect } from "react-router";

/** We dont render anything on /settings
 * We just redirect to default subroute which is user
 */
export function loader() {
  return redirect("general");
}

export const shouldRevalidate = () => false;
