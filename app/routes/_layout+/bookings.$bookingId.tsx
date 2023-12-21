import { BookingStatus } from "@prisma/client";
import { json, redirect } from "@remix-run/node";
import type {
  ActionFunctionArgs,
  MetaFunction,
  LoaderFunctionArgs,
} from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { useAtomValue } from "jotai";
import { DateTime } from "luxon";
import { parseFormAny } from "react-zorm";
import { dynamicTitleAtom } from "~/atoms/dynamic-title-atom";
import { BookingForm, NewBookingFormSchema } from "~/components/booking";
import ContextualModal from "~/components/layout/contextual-modal";
import Header from "~/components/layout/header";
import type { HeaderData } from "~/components/layout/header/types";
import { Badge } from "~/components/shared";
import { db } from "~/database";
import { commitAuthSession, requireAuthSession } from "~/modules/auth";
import {
  deleteBooking,
  getBooking,
  removeAssets,
  upsertBooking,
} from "~/modules/booking";
import {
  requireOrganisationId,
  setSelectedOrganizationIdCookie,
} from "~/modules/organization/context.server";
import {
  generatePageMeta,
  getCurrentSearchParams,
  getParamsValues,
  getRequiredParam,
} from "~/utils";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";
import { getHints } from "~/utils/client-hints";
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
import { bookingStatusColorMap } from "./bookings._index";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const authSession = await requireAuthSession(request);
  const { organizationId } = await requireOrganisationId(authSession, request);
  const bookingId = getRequiredParam(params, "bookingId");

  const teamMembers = await db.teamMember.findMany({
    where: {
      deletedAt: null,
      organizationId,
    },
    include: {
      user: true,
    },
    orderBy: {
      userId: "asc",
    },
  });

  const booking = await getBooking({ id: bookingId });

  if (!booking) {
    throw new ShelfStackError({ message: "Booking not found", status: 404 });
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
      items: booking.assets,
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
  breadcrumb: () => "Edit",
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
    | "archive";

  const intent2ActionMap: { [K in typeof intent]: PermissionAction } = {
    delete: PermissionAction.delete,
    reserve: PermissionAction.create,
    save: PermissionAction.update,
    removeAsset: PermissionAction.update,
    checkOut: PermissionAction.update,
    checkIn: PermissionAction.update,
    archive: PermissionAction.update,
  };
  const { authSession, organizationId } = await requirePermision(
    request,
    PermissionEntity.booking,
    intent2ActionMap[intent]
  );
  const id = getRequiredParam(params, "bookingId");

  switch (intent) {
    case "save":
      const result = await NewBookingFormSchema.safeParseAsync(
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
      var booking = await upsertBooking({
        custodianTeamMemberId: custodian,
        organizationId,
        id,
        name,
        from,
        to,
      });

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
      await upsertBooking({ id, status: BookingStatus.RESERVED });
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
      await deleteBooking({ id });
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
      var booking = await removeAssets({ id, assetIds: [assetId as string] });
      sendNotification({
        title: "Asset removed",
        message: "Your asset has been removed from the booking",
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
    case "checkOut":
      // @TODO here we have to make sure assets are updated to checked-out
      var booking = await upsertBooking({ id, status: BookingStatus.ONGOING });
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
      // TODO - status of assets should be updated to available
      var booking = await upsertBooking({
        id,
        status: BookingStatus.COMPLETE,
      });
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
      await upsertBooking({ id, status: BookingStatus.ARCHIVED });
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
    default:
      return null;
  }
}

export default function BookingEditPage() {
  const name = useAtomValue(dynamicTitleAtom);
  const hasName = name !== "";
  const { booking, teamMembers } = useLoaderData<typeof loader>();

  return (
    <>
      <Header title={hasName ? name : booking.name} />
      <div>
        <Badge color={bookingStatusColorMap[booking.status]}>
          <span className="block lowercase first-letter:uppercase">
            {booking.status}
          </span>
        </Badge>
      </div>

      <div>
        <BookingForm
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
          custodianId={
            booking.custodianTeamMemberId ||
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
