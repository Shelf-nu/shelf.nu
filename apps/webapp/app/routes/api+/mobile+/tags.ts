import { data, type LoaderFunctionArgs } from "react-router";
import {
  getMobileUserContext,
  requireMobileAuth,
  requireOrganizationAccess,
} from "~/modules/api/mobile-auth.server";
import { getTagsForAssetTagsFilter } from "~/modules/tag/service.server";
import { makeShelfError } from "~/utils/error";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { hasPermission } from "~/utils/permissions/permission.validator.server";

/**
 * GET /api/mobile/tags
 *
 * Returns the tags assignable to assets (tags whose `useFor` is empty or
 * contains ASSET) for the tag picker on the mobile create-asset form. Uses the
 * same `getTagsForAssetTagsFilter` source as the web asset form, so the two
 * stay in sync. Mirrors the structure of the `/api/mobile/bookings/tags`
 * endpoint, and sits alongside the other top-level asset-form pickers
 * (`/api/mobile/categories`, `/api/mobile/locations`).
 *
 * Also returns `canCreate` — whether the caller may mint a new tag via
 * `POST /api/mobile/tags/create` — so the picker can gate its inline
 * "create tag" affordance server-side instead of guessing roles on-device.
 *
 * Query: ?orgId=...
 *
 * @see {@link file://./bookings.tags.ts} the booking tag picker (same shape).
 * @see {@link file://../../_layout+/assets.new.tsx} web asset form (same source).
 */
export async function loader({ request }: LoaderFunctionArgs) {
  try {
    const { user } = await requireMobileAuth(request);
    const organizationId = await requireOrganizationAccess(request, user.id);

    const [{ tags }, { role }] = await Promise.all([
      getTagsForAssetTagsFilter({ organizationId }),
      getMobileUserContext(user.id, organizationId),
    ]);

    // Server-computed capability flag (same pattern as the booking detail's
    // `bookingActions`): the picker shows its inline "create tag" affordance
    // only when the caller could actually create one, so self-service users
    // never see a control that would 403.
    const canCreate = await hasPermission({
      userId: user.id,
      organizationId,
      roles: [role],
      entity: PermissionEntity.tag,
      action: PermissionAction.create,
    });

    return data({
      tags: tags.map((tag) => ({ id: tag.id, name: tag.name })),
      canCreate,
    });
  } catch (cause) {
    const reason = makeShelfError(cause);
    return data(
      { error: { message: reason.message } },
      { status: reason.status }
    );
  }
}
