import { redirect } from "react-router";

/**
 * We don't render anything on /assets.$assetId
 * We just redirect to default sub-route which is /assets.$assetId/overview
 */
export function loader() {
  return redirect("overview");
}

export const shouldRevalidate = () => false;
