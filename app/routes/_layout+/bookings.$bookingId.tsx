import { BookingStatus, OrganizationRoles } from "@prisma/client";
import { json, redirect } from "@remix-run/node";
import type {
  ActionFunctionArgs,
  MetaFunction,
  LoaderFunctionArgs,
} from "@remix-run/node";
import type { ShouldRevalidateFunction } from "@remix-run/react";
import { useLoaderData } from "@remix-run/react";
import { useAtomValue } from "jotai";
import { DateTime } from "luxon";
import { parseFormAny } from "react-zorm";
import { dynamicTitleAtom } from "~/atoms/dynamic-title-atom";
import { BookingPageContent } from "~/components/booking";
import { NewBookingFormSchema } from "~/components/booking/form";
import ContextualModal from "~/components/layout/contextual-modal";
import Header from "~/components/layout/header";
import type { HeaderData } from "~/components/layout/header/types";
import { Badge } from "~/components/shared";
import { db } from "~/database";
import { commitAuthSession } from "~/modules/auth";
import {
  deleteBooking,
  getBooking,
  removeAssets,
  upsertBooking,
} from "~/modules/booking";
import { setSelectedOrganizationIdCookie } from "~/modules/organization/context.server";
import { getUserByID } from "~/modules/user";
import {
  generatePageMeta,
  getCurrentSearchParams,
  getParamsValues,
  getRequiredParam,
} from "~/utils";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";
import { getClientHint, getHints } from "~/utils/client-hints";
import {
  setCookie,
  updateCookieWithPerPage,
  userPrefs,
} from "~/utils/cookies.server";
import { dateForDateTimeInputValue } from "~/utils/date-fns";
import { sendNotification } from "~/utils/emitter/send-notification.server";
import { ShelfStackError } from "~/utils/error";
import { PermissionAction, PermissionEntity } from "~/utils/permissions";
import { requirePermision } from "~/utils/roles.server";
import { bookingStatusColorMap } from "./bookings";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { authSession, organizationId, role } = await requirePermision(
    request,
    PermissionEntity.booking,
    PermissionAction.read
  );
  const isSelfService = role === OrganizationRoles.SELF_SERVICE;

  const bookingId = getRequiredParam(params, "bookingId");
  const user = await getUserByID(authSession.userId);

  const teamMembers = await db.teamMember.findMany({
    where: {
      deletedAt: null,
      organizationId,
      userId: {
        not: null,
      },
    },
    include: {
      user: true,
    },
    orderBy: {
      userId: "asc",
    },
  });

  /** We create a teamMember entry to represent the org owner.
   * Most important thing is passing the ID of the owner as the userId as we are currently only supporting
   * assigning custody to users, not NRM.
   */
  teamMembers.push({
    id: "owner",
    name: "owner",
    user: user,
    userId: user?.id as string,
    organizationId,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
  });

  const booking = await getBooking({ id: bookingId });
  if (!booking) {
    throw new ShelfStackError({ message: "Booking not found", status: 404 });
  }

  /**
   * We need to do this in a separate query because we need to filter the bookings within an asset based on the booking.from and booking.to
   * That way we know if the asset is available or not because we can see if they are booked for the same period
   */
  const assets = await db.asset.findMany({
    where: {
      id: {
        in: booking?.assets.map((a) => a.id) || [],
      },
    },
    include: {
      category: true,
      custody: true,
      bookings: {
        where: {
          // id: { not: booking.id },
          ...(booking.from && booking.to
            ? {
                status: { in: ["RESERVED", "ONGOING", "OVERDUE"] },
                OR: [
                  {
                    from: { lte: booking.to },
                    to: { gte: booking.from },
                  },
                  {
                    from: { gte: booking.from },
                    to: { lte: booking.to },
                  },
                ],
              }
            : {}),
        },
      },
    },
  });

  /** We replace the assets ids in the booking object with the assets fetched in the separate request.
   * This is useful for more consistent data in the front-end */
  booking.assets = assets;

  /** For self service users, we only allow them to read their own bookings */
  if (isSelfService && booking.custodianUserId !== authSession.userId) {
    throw new ShelfStackError({
      message: "You are not authorized to view this booking",
      status: 403,
    });
  }

  const searchParams = getCurrentSearchParams(request);
  const { page, perPageParam } = getParamsValues(searchParams);
  const cookie = await updateCookieWithPerPage(request, perPageParam);
  const { perPage } = cookie;
  const modelName = {
    singular: "asset",
    plural: "assets",
  };
  const { prev, next } = generatePageMeta(request);

  const header: HeaderData = {
    title: `Edit | ${booking.name}`,
  };

  return json(
    {
      header,
      booking: booking,
      modelName,
      items: assets,
      page,
      totalItems: booking.assets.length,
      perPage,
      totalPages: booking.assets.length / perPage,
      next,
      prev,
      teamMembers,
    },
    {
      headers: {
        "Set-Cookie": await userPrefs.serialize(cookie),
      },
    }
  );
}

export const meta: MetaFunction<typeof loader> = ({ data }) => [
  { title: data ? appendToMetaTitle(data.header.title) : "" },
];

export const handle = {
  breadcrumb: () => <span>Edit</span>,
};

export async function action({ request, params }: ActionFunctionArgs) {
  const formData = await request.formData();
  const intent = formData.get("intent") as
    | "save"
    | "reserve"
    | "delete"
    | "removeAsset"
    | "checkOut"
    | "checkIn"
    | "archive"
    | "cancel";

  const intent2ActionMap: { [K in typeof intent]: PermissionAction } = {
    delete: PermissionAction.delete,
    reserve: PermissionAction.create,
    save: PermissionAction.update,
    removeAsset: PermissionAction.update,
    checkOut: PermissionAction.checkout,
    checkIn: PermissionAction.checkin,
    archive: PermissionAction.update,
    cancel: PermissionAction.update,
  };
  const { authSession, organizationId, role } = await requirePermision(
    request,
    PermissionEntity.booking,
    intent2ActionMap[intent]
  );
  const id = getRequiredParam(params, "bookingId");
  const isSelfService = role === OrganizationRoles.SELF_SERVICE;

  switch (intent) {
    case "save":
      const result = await NewBookingFormSchema().safeParseAsync(
        parseFormAny(formData)
      );

      if (!result.success) {
        return json(
          {
            errors: result.error,
            success: false,
          },
          {
            status: 400,
            headers: {
              "Set-Cookie": await commitAuthSession(request, { authSession }),
            },
          }
        );
      }

      const { name, custodian } = result.data;
      const hints = getHints(request);
      const startDate = formData.get("startDate")!.toString();
      const endDate = formData.get("endDate")!.toString();
      const fmt = "yyyy-MM-dd'T'HH:mm";
      const from = DateTime.fromFormat(startDate, fmt, {
        zone: hints.timeZone,
      }).toJSDate();
      const to = DateTime.fromFormat(endDate, fmt, {
        zone: hints.timeZone,
      }).toJSDate();
      var booking = await upsertBooking(
        {
          custodianUserId: custodian,
          organizationId,
          id,
          name,
          from,
          to,
        },
        getClientHint(request)
      );

      sendNotification({
        title: "Booking saved",
        message: "Your booking has been saved successfully",
        icon: { name: "success", variant: "success" },
        senderId: authSession.userId,
      });
      return json(
        { booking },
        {
          status: 200,
          headers: [
            setCookie(await commitAuthSession(request, { authSession })),
            setCookie(await setSelectedOrganizationIdCookie(organizationId)),
          ],
        }
      );
    case "reserve":
      await upsertBooking(
        { id, status: BookingStatus.RESERVED },
        getClientHint(request),
        isSelfService
      );
      sendNotification({
        title: "Booking reserved",
        message: "Your booking has been reserved successfully",
        icon: { name: "success", variant: "success" },
        senderId: authSession.userId,
      });
      return json(
        { success: true },
        {
          headers: [
            setCookie(await commitAuthSession(request, { authSession })),
            setCookie(await setSelectedOrganizationIdCookie(organizationId)),
          ],
        }
      );
    case "delete":
      if (isSelfService) {
        /**
         * When user is self_service we need to check if the booking belongs to them and only then allow them to delete it.
         * They have delete permissions but shouldnt be able to delete other people's bookings
         * Practically they should not be able to even view/access another booking but this is just an extra security measure
         */
        const b = await getBooking({ id });
        if (
          b?.creatorId !== authSession.userId &&
          b?.custodianUserId !== authSession.userId
        ) {
          throw new ShelfStackError({
            message: "You are not authorized to delete this booking",
            status: 403,
          });
        }
      }

      await deleteBooking({ id }, getClientHint(request));
      sendNotification({
        title: "Booking deleted",
        message: "Your booking has been deleted successfully",
        icon: { name: "trash", variant: "error" },
        senderId: authSession.userId,
      });
      return redirect("/bookings", {
        headers: [
          setCookie(await commitAuthSession(request, { authSession })),
          setCookie(await setSelectedOrganizationIdCookie(organizationId)),
        ],
      });
    case "removeAsset":
      const assetId = formData.get("assetId");
      const user = await getUserByID(authSession.userId);
      if (!user) {
        throw new ShelfStackError({ message: "User not found" });
      }
      var b = await removeAssets({
        booking: { id, assetIds: [assetId as string] },
        firstName: user?.firstName || "",
        lastName: user?.lastName || "",
        userId: authSession.userId,
      });
      sendNotification({
        title: "Asset removed",
        message: "Your asset has been removed from the booking",
        icon: { name: "success", variant: "success" },
        senderId: authSession.userId,
      });
      return json(
        { booking: b },
        {
          status: 200,
          headers: [
            setCookie(await commitAuthSession(request, { authSession })),
            setCookie(await setSelectedOrganizationIdCookie(organizationId)),
          ],
        }
      );
    case "checkOut":
      var booking = await upsertBooking(
        { id, status: BookingStatus.ONGOING },
        getClientHint(request)
      );
      sendNotification({
        title: "Booking checked-out",
        message: "Your booking has been checked-out successfully",
        icon: { name: "success", variant: "success" },
        senderId: authSession.userId,
      });
      return json(
        { success: true },
        {
          headers: [
            setCookie(await commitAuthSession(request, { authSession })),
            setCookie(await setSelectedOrganizationIdCookie(organizationId)),
          ],
        }
      );
    case "checkIn":
      var booking = await upsertBooking(
        {
          id,
          status: BookingStatus.COMPLETE,
        },
        getClientHint(request)
      );
      sendNotification({
        title: "Booking checked-in",
        message: "Your booking has been checked-in successfully",
        icon: { name: "success", variant: "success" },
        senderId: authSession.userId,
      });
      return json(
        { success: true },
        {
          headers: [
            setCookie(await commitAuthSession(request, { authSession })),
            setCookie(await setSelectedOrganizationIdCookie(organizationId)),
          ],
        }
      );
    case "archive":
      await upsertBooking(
        { id, status: BookingStatus.ARCHIVED },
        getClientHint(request)
      );
      sendNotification({
        title: "Booking archived",
        message: "Your booking has been archived successfully",
        icon: { name: "success", variant: "success" },
        senderId: authSession.userId,
      });
      return json(
        { success: true },
        {
          headers: [
            setCookie(await commitAuthSession(request, { authSession })),
            setCookie(await setSelectedOrganizationIdCookie(organizationId)),
          ],
        }
      );
    case "cancel":
      await upsertBooking(
        { id, status: BookingStatus.CANCELLED },
        getClientHint(request)
      );
      sendNotification({
        title: "Booking canceled",
        message: "Your booking has been canceled successfully",
        icon: { name: "success", variant: "success" },
        senderId: authSession.userId,
      });
      return json(
        { success: true },
        {
          headers: [
            setCookie(await commitAuthSession(request, { authSession })),
            setCookie(await setSelectedOrganizationIdCookie(organizationId)),
          ],
        }
      );
    default:
      return null;
  }
}

export const shouldRevalidate: ShouldRevalidateFunction = ({
  nextUrl,
  defaultShouldRevalidate,
}) => {
  /** Dont revalidate on add-assets route */
  const isAddAssetsRoute = nextUrl.pathname.includes("add-assets");
  if (isAddAssetsRoute) {
    return false;
  }
  return defaultShouldRevalidate;
};

export default function BookingEditPage() {
  const name = useAtomValue(dynamicTitleAtom);
  const hasName = name !== "";
  const { booking, teamMembers } = useLoaderData<typeof loader>();

  return (
    <>
      <Header
        title={hasName ? name : booking.name}
        subHeading={
          <Badge color={bookingStatusColorMap[booking.status]}>
            <span className="block lowercase first-letter:uppercase">
              {booking.status}
            </span>
          </Badge>
        }
      />

      <div>
        <BookingPageContent
          id={booking.id}
          name={booking.name}
          startDate={
            booking.from
              ? dateForDateTimeInputValue(new Date(booking.from))
              : undefined
          }
          endDate={
            booking.to
              ? dateForDateTimeInputValue(new Date(booking.to))
              : undefined
          }
          custodianUserId={
            booking.custodianUserId ||
            teamMembers.find(
              (member) => member.user?.id === booking.custodianUserId
            )?.id
          }
        />
        <ContextualModal />
      </div>
    </>
  );
}
