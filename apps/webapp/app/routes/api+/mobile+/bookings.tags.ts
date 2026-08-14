import { data, type LoaderFunctionArgs } from "react-router";
import {
  requireMobileAuth,
  requireOrganizationAccess,
} from "~/modules/api/mobile-auth.server";
import { getTagsForBookingTagsFilter } from "~/modules/tag/service.server";
import { makeShelfError } from "~/utils/error";

/**
 * GET /api/mobile/bookings/tags
 *
 * Returns the tags assignable to bookings (tags whose `useFor` is empty or
 * contains BOOKING) for the tag picker on the mobile booking form. Uses the same
 * `getTagsForBookingTagsFilter` source as the web booking form, so the two stay
 * in sync. Required because a workspace with `tagsRequired` rejects a
 * create/reserve that has no tag.
 *
 * Query: ?orgId=...
 *
 * @see {@link file://../../_layout+/bookings.new.tsx} web booking form (same source)
 */
export async function loader({ request }: LoaderFunctionArgs) {
  try {
    const { user } = await requireMobileAuth(request);
    const organizationId = await requireOrganizationAccess(request, user.id);

    const { tags } = await getTagsForBookingTagsFilter({ organizationId });

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
