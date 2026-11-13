import { data, type LoaderFunctionArgs } from "react-router";
import {
  requireMobileAuth,
  getUserOrganizations,
  getMobileWorkspaceStates,
  type MobileWorkspaceState,
} from "~/modules/api/mobile-auth.server";
import { ShelfError, makeShelfError } from "~/utils/error";
import { Logger } from "~/utils/logger";

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
 * The state is extra information: when reading it fails, every workspace is
 * reported active (the other routes still refuse an inactive one) and the
 * profile and workspaces are answered as usual.
 */
export async function loader({ request }: LoaderFunctionArgs) {
  try {
    const { user } = await requireMobileAuth(request);
    const { organizations, lastSelectedOrganizationId } =
      await getUserOrganizations(user.id);
    const states = await getMobileWorkspaceStates({
      userId: user.id,
      organizationIds: organizations.map((org) => org.id),
    }).catch((cause: unknown) => {
      Logger.error(
        new ShelfError({
          cause,
          message: "Failed to read the workspace states for /api/mobile/me",
          additionalData: { userId: user.id },
          label: "Auth",
        })
      );
      return new Map<string, MobileWorkspaceState>();
    });

    return data({
      user,
      organizations: organizations.map((org) => ({
        ...org,
        ...(states.get(org.id) ?? {
          inactive: false,
          inactiveReason: null,
          inactiveMessage: null,
        }),
      })),
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
