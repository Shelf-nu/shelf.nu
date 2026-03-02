import { redirect } from "react-router";

/**
 * We don't render anything on /kits.$kitId
 * We just redirect to default sub-route which is /kits.$kitId/assets
 */
export function loader() {
  return redirect("assets");
}

export const shouldRevalidate = () => false;
