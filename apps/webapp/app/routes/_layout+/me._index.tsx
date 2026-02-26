import { redirect } from "react-router";

/**
 * We do not render anything on /me
 * We just redirect to default sub-route which is /assets
 */
export function loader() {
  return redirect("assets");
}

export const shouldRevalidate = () => false;
