import { redirect } from "react-router";

/**
 * We don't render anything on /locations.$locationId
 * We just redirect to default sub-route which is /locations.$locationId/assets
 */
export function loader() {
  return redirect("assets");
}

export const shouldRevalidate = () => false;
