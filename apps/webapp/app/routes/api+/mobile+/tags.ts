import { data, type LoaderFunctionArgs } from "react-router";
import {
  requireMobileAuth,
  requireOrganizationAccess,
} from "~/modules/api/mobile-auth.server";
import { getTagsForAssetTagsFilter } from "~/modules/tag/service.server";
import { makeShelfError } from "~/utils/error";

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
 * Query: ?orgId=...
 *
 * @see {@link file://./bookings.tags.ts} the booking tag picker (same shape).
 * @see {@link file://../../_layout+/assets.new.tsx} web asset form (same source).
 */
export async function loader({ request }: LoaderFunctionArgs) {
  try {
    const { user } = await requireMobileAuth(request);
    const organizationId = await requireOrganizationAccess(request, user.id);

    const { tags } = await getTagsForAssetTagsFilter({ organizationId });

    return data({
      tags: tags.map((tag) => ({ id: tag.id, name: tag.name })),
    });
  } catch (cause) {
    const reason = makeShelfError(cause);
    return data(
      { error: { message: reason.message } },
      { status: reason.status }
    );
  }
}
