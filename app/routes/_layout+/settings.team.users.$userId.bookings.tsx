import type { MetaFunction } from "react-router";
import { data, type LoaderFunctionArgs } from "react-router";
import { z } from "zod";
import type { HeaderData } from "~/components/layout/header/types";
import { getBookings } from "~/modules/booking/service.server";
import { getTagsForBookingTagsFilter } from "~/modules/tag/service.server";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";
import {
  setCookie,
  updateCookieWithPerPage,
  userPrefs,
} from "~/utils/cookies.server";
import { makeShelfError } from "~/utils/error";
import {
  payload,
  error,
  getCurrentSearchParams,
  getParams,
} from "~/utils/http.server";
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

export const meta: MetaFunction<typeof loader> = ({ loaderData }) => [
  { title: appendToMetaTitle(loaderData?.header?.title) },
];

export async function loader({ context, request, params }: LoaderFunctionArgs) {
  const authSession = context.getSession();
  const { userId } = authSession;

  const { userId: selectedUserId } = getParams(
    params,
    z.object({ userId: z.string() }),
    {
      additionalData: { userId },
    }
  );

  try {
    const { organizationId } = await requirePermission({
      userId,
      request,
      entity: PermissionEntity.teamMemberProfile,
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
        userId: authSession?.userId,
        custodianUserId: selectedUserId, // Here we just hardcode the userId because user profiles cannot be seen by other selfService or Base users
        ...(status && {
          // If status is in the params, we filter based on it
          statuses: [status],
        }),
        tags: filterTags,
        extraInclude: {
          tags: { select: { id: true, name: true, color: true } },
        },
      }),
      getTagsForBookingTagsFilter({
        organizationId,
      }),
    ]);
    const totalPages = Math.ceil(bookingCount / perPage);

    const header: HeaderData = {
      title: "Team member bookings",
    };
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
      }),
      {
        headers: [setCookie(await userPrefs.serialize(cookie))],
      }
    );
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    throw data(error(reason), { status: reason.status });
  }
}

export const handle = {
  name: "$userId.bookings",
};

export default function UserBookingsPage() {
  return <BookingsIndexPage disableBulkActions />;
}
