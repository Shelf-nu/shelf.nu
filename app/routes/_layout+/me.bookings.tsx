import { data, type LoaderFunctionArgs } from "react-router";
import type { HeaderData } from "~/components/layout/header/types";
import { getBookings } from "~/modules/booking/service.server";
import { getTagsForBookingTagsFilter } from "~/modules/tag/service.server";
import { updateCookieWithPerPage } from "~/utils/cookies.server";
import { makeShelfError } from "~/utils/error";
import { payload, error, getCurrentSearchParams } from "~/utils/http.server";
import { getParamsValues } from "~/utils/list";
import { parseMarkdownToReact } from "~/utils/md";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { requirePermission } from "~/utils/roles.server";
import BookingsIndexPage, {
  bookingsSearchFieldTooltipText,
} from "./bookings._index";

export async function loader({ context, request }: LoaderFunctionArgs) {
  const authSession = context.getSession();
  const userId = authSession.userId;

  try {
    const { organizationId } = await requirePermission({
      userId,
      request,
      entity: PermissionEntity.booking,
      action: PermissionAction.read,
    });

    const searchParams = getCurrentSearchParams(request);
    const {
      page,
      perPageParam,
      search,
      status,
      tags: filterTags,
    } = getParamsValues(searchParams);

    const cookie = await updateCookieWithPerPage(request, perPageParam);
    const { perPage } = cookie;

    const [{ bookings, bookingCount }, tagsData] = await Promise.all([
      getBookings({
        organizationId,
        page,
        perPage,
        search,
        userId,
        custodianUserId: userId, // Here we just hardcode the userId because only current user can see their own bookings
        ...(status && {
          // If status is in the params, we filter based on it
          statuses: [status],
        }),
        tags: filterTags,
        extraInclude: {
          tags: { select: { id: true, name: true } },
        },
      }),
      getTagsForBookingTagsFilter({
        organizationId,
      }),
    ]);

    const totalPages = Math.ceil(bookingCount / perPage);

    const header: HeaderData = { title: "Bookings" };

    const modelName = {
      singular: "booking",
      plural: "bookings",
    };

    return data(
      payload({
        header,
        items: bookings,
        search,
        page,
        totalItems: bookingCount,
        totalPages,
        perPage,
        modelName,
        ...tagsData,
        searchFieldTooltip: {
          title: "Search your bookings",
          text: parseMarkdownToReact(bookingsSearchFieldTooltipText),
        },
      })
    );
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    throw data(error(reason), { status: reason.status });
  }
}

export default function MyBookings() {
  return <BookingsIndexPage disableBulkActions />;
}

export const handle = {
  name: "me.bookings",
};
