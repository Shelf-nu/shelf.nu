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
 * `selfServiceCanSeeCustody`, `baseUserCanSeeCustody`), so the companion can
 * resolve the same access the server resolves for that workspace.
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
