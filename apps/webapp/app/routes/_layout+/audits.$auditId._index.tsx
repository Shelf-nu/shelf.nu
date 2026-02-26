import { redirect } from "react-router";

/**
 * Index route for /audits/:auditId
 * Redirects to the default tab (overview)
 */
export function loader() {
  return redirect("overview");
}
