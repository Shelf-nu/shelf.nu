import { data, type LoaderFunctionArgs } from "react-router";
import {
  requireMobileAuth,
  getUserOrganizations,
} from "~/modules/api/mobile-auth.server";
import { makeShelfError } from "~/utils/error";

/**
 * GET /api/mobile/me
 *
 * Returns the authenticated user's profile and organizations.
 * Mobile clients use this after login to set up the app context.
 *
 * Each organization in the response carries the four workspace visibility
 * toggles (`selfServiceCanSeeBookings`, `baseUserCanSeeBookings`,
 * `selfServiceCanSeeCustody`, `baseUserCanSeeCustody`) and the permission
 * switch `managersCanEditAssets`, so the companion can resolve the same access
 * and the same matrix answers the server resolves for that workspace.
 *
 * Each organization also carries `inactive`, `inactiveReason` and
 * `inactiveMessage`: whether every other mobile route refuses requests in it
 * (a lapsed Team plan, or switched off by a Shelf admin). This route itself
 * stays open, so the app can list an inactive workspace and offer the others.
 * The state is extra information: a workspace whose state cannot be worked out
 * is reported active, and the other routes still refuse it.
 */
export async function loader({ request }: LoaderFunctionArgs) {
  try {
    const { user } = await requireMobileAuth(request);
    const { organizations, lastSelectedOrganizationId } =
      await getUserOrganizations(user.id);

    return data({
      user,
      organizations,
      lastSelectedOrganizationId,
    });
  } catch (cause) {
    const reason = makeShelfError(cause);
    return data(
      { error: { message: reason.message } },
      { status: reason.status }
    );
  }
}
