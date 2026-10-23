/**
 * `/`: the entry point. Sends a signed-in member to their role's landing page
 * and everyone else to login. Renders nothing itself.
 *
 * @see {@link file://../utils/permissions/role-access.ts} `ROLE_POLICIES[role].ui.landing`
 */
import type { LoaderFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { getSelectedOrganization } from "~/modules/organization/context.server";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";
import { ROLE_POLICIES, resolveRole } from "~/utils/permissions/role-access";

export const meta = () => [{ title: appendToMetaTitle("Home") }];

/**
 * `/` sends a signed-in member to their role's landing page and everyone else
 * to login. A member whose membership cannot be read yet (onboarding, no
 * workspace) goes to `/assets`, whose layout handles those states.
 */
export const loader = async ({ context, request }: LoaderFunctionArgs) => {
  if (!context.isAuthenticated) {
    return redirect("/login");
  }

  try {
    const { userId } = context.getSession();
    const { organizationId, userOrganizations } = await getSelectedOrganization(
      { userId, request }
    );
    const roles = userOrganizations.find(
      (o) => o.organization.id === organizationId
    )?.roles;
    return redirect(ROLE_POLICIES[resolveRole(roles)].ui.landing);
  } catch {
    return redirect("/assets");
  }
};

/** Never rendered: the loader always redirects. */
export default function Route() {
  return null;
}
