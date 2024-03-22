import { BookingStatus, OrganizationRoles } from "@prisma/client";
import { json, redirect } from "@remix-run/node";
import type {
  ActionFunctionArgs,
  MetaFunction,
  LoaderFunctionArgs,
} from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { useAtomValue } from "jotai";
import { DateTime } from "luxon";
import { z } from "zod";
import { dynamicTitleAtom } from "~/atoms/dynamic-title-atom";
import { NewBookingFormSchema } from "~/components/booking/form";
import { BookingPageContent } from "~/components/booking/page-content";
import ContextualModal from "~/components/layout/contextual-modal";
import Header from "~/components/layout/header";
import type { HeaderData } from "~/components/layout/header/types";
import { Badge } from "~/components/shared/badge";
import { db } from "~/database";
import { createNotes } from "~/modules/asset";
import {
  deleteBooking,
  getBooking,
  removeAssets,
  upsertBooking,
} from "~/modules/booking";
import { setSelectedOrganizationIdCookie } from "~/modules/organization/context.server";
import { getUserByID } from "~/modules/user";
import {
  data,
  error,
  getCurrentSearchParams,
  getParams,
  getParamsValues,
  parseData,
} from "~/utils";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";
import { checkExhaustiveSwitch } from "~/utils/check-exhaustive-switch";
import { getClientHint, getHints } from "~/utils/client-hints";
import {
  setCookie,
  updateCookieWithPerPage,
  userPrefs,
} from "~/utils/cookies.server";
import { dateForDateTimeInputValue } from "~/utils/date-fns";
import { sendNotification } from "~/utils/emitter/send-notification.server";
import { ShelfError, makeShelfError } from "~/utils/error";
import { PermissionAction, PermissionEntity } from "~/utils/permissions";
import { requirePermission } from "~/utils/roles.server";
import { bookingStatusColorMap } from "./bookings";

export async function loader({ context, request, params }: LoaderFunctionArgs) {
  const authSession = context.getSession();
  const { userId } = authSession;
  const { bookingId } = getParams(params, z.object({ bookingId: z.string() }), {
    additionalData: { userId },
  });

  try {
    const { organizationId, role } = await requirePermission({
      userId: authSession?.userId,
      request,
      entity: PermissionEntity.booking,
      action: PermissionAction.create,
    });

    const searchParams = getCurrentSearchParams(request);

    /**
     * If the org id in the params is different than the current organization id,
     * we need to redirect and set the organization id in the cookie
     * This is useful when the user is viewing a booking from a different organization that they are part of after clicking link in email
     */
    const orgId = searchParams.get("orgId");
    if (orgId && orgId !== organizationId) {
      return redirect(`/bookings/${bookingId}`, {
        headers: [setCookie(await setSelectedOrganizationIdCookie(orgId))],
      });
    }

    const isSelfService = role === OrganizationRoles.SELF_SERVICE;
    const booking = await getBooking({
      id: bookingId,
      organizationId: organizationId,
    });

    const [teamMembers, org, assets] = await Promise.all([
      /**
       * We need to fetch the team members to be able to display them in the custodian dropdown.
       */
      db.teamMember.findMany({
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
      }),
      /** We create a teamMember entry to represent the org owner.
       * Most important thing is passing the ID of the owner as the userId as we are currently only supporting
       * assigning custody to users, not NRM.
       */
      db.organization.findUnique({
        where: {
          id: organizationId,
        },
        select: {
          owner: true,
        },
      }),
      /**
       * We need to do this in a separate query because we need to filter the bookings within an asset based on the booking.from and booking.to
       * That way we know if the asset is available or not because we can see if they are booked for the same period
       */
      db.asset.findMany({
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
      }),
    ]);

    if (org?.owner) {
      teamMembers.push({
        id: "owner",
        name: "owner",
        user: org.owner,
        userId: org.owner.id as string,
        organizationId,
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: null,
      });
    }

    /** We replace the assets ids in the booking object with the assets fetched in the separate request.
     * This is useful for more consistent data in the front-end */
    booking.assets = assets;

    /** For self service users, we only allow them to read their own bookings */
    if (isSelfService && booking.custodianUserId !== authSession.userId) {
      throw new ShelfError({
        cause: null,
        message: "You are not authorized to view this booking",
        status: 403,
        label: "Booking",
      });
    }

    const { page, perPageParam } = getParamsValues(searchParams);
    const cookie = await updateCookieWithPerPage(request, perPageParam);
    const { perPage } = cookie;
    const modelName = {
      singular: "asset",
      plural: "assets",
    };

    const header: HeaderData = {
      title: `Edit | ${booking.name}`,
    };

    return json(
      data({
        header,
        booking: booking,
        modelName,
        items: assets,
        page,
        totalItems: booking.assets.length,
        perPage,
        totalPages: booking.assets.length / perPage,
        teamMembers,
      }),
      {
        headers: [setCookie(await userPrefs.serialize(cookie))],
      }
    );
  } catch (cause) {
    const reason = makeShelfError(cause, { userId, bookingId });
    throw json(error(reason), { status: reason.status });
  }
}

export const meta: MetaFunction<typeof loader> = ({ data }) => [
  { title: data ? appendToMetaTitle(data.header.title) : "" },
];

export const handle = {
  breadcrumb: () => "single",
};

export async function action({ context, request, params }: ActionFunctionArgs) {
  const authSession = context.getSession();
  const { userId } = authSession;
  const { bookingId: id } = getParams(
    params,
    z.object({ bookingId: z.string() }),
    {
      additionalData: { userId },
    }
  );

  try {
    const { intent } = parseData(
      await request.clone().formData(),
      z.object({
        intent: z.enum([
          "save",
          "reserve",
          "delete",
          "removeAsset",
          "checkOut",
          "checkIn",
          "archive",
          "cancel",
        ]),
      }),
      {
        additionalData: { userId },
      }
    );

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

    const { organizationId, role } = await requirePermission({
      userId: authSession?.userId,
      request,
      entity: PermissionEntity.booking,
      action: intent2ActionMap[intent],
    });
    const isSelfService = role === OrganizationRoles.SELF_SERVICE;
    const user = await getUserByID(authSession.userId);

    const headers = [
      setCookie(await setSelectedOrganizationIdCookie(organizationId)),
    ];

    switch (intent) {
      case "save": {
        const formData = await request.formData();
        const payload = parseData(formData, NewBookingFormSchema(), {
          additionalData: { userId, id, organizationId, role },
        });

        const { name, custodian } = payload;
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
        const booking = await upsertBooking(
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

        return json(data({ booking }), {
          headers,
        });
      }
      case "reserve": {
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

        return json(data({ success: true }), {
          headers,
        });
      }
      case "delete": {
        if (isSelfService) {
          /**
           * When user is self_service we need to check if the booking belongs to them and only then allow them to delete it.
           * They have delete permissions but shouldnt be able to delete other people's bookings
           * Practically they should not be able to even view/access another booking but this is just an extra security measure
           */
          const b = await getBooking({ id, organizationId });
          if (
            b?.creatorId !== authSession.userId &&
            b?.custodianUserId !== authSession.userId
          ) {
            throw new ShelfError({
              cause: null,
              message: "You are not authorized to delete this booking",
              status: 403,
              label: "Booking",
            });
          }
        }

        const deletedBooking = await deleteBooking(
          { id },
          getClientHint(request)
        );

        await createNotes({
          content: `**${user?.firstName?.trim()} ${user?.lastName?.trim()}** deleted booking **${
            deletedBooking.name
          }**.`,
          type: "UPDATE",
          userId: authSession.userId,
          assetIds: deletedBooking.assets.map((a) => a.id),
        });

        sendNotification({
          title: "Booking deleted",
          message: "Your booking has been deleted successfully",
          icon: { name: "trash", variant: "error" },
          senderId: authSession.userId,
        });

        return redirect("/bookings", {
          headers,
        });
      }
      case "removeAsset": {
        const { assetId } = parseData(
          await request.formData(),
          z.object({
            assetId: z.string(),
          }),
          {
            additionalData: { userId, id, organizationId, role },
          }
        );

        const b = await removeAssets({
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

        return json(data({ booking: b }), {
          headers,
        });
      }
      case "checkOut": {
        const booking = await upsertBooking(
          { id, status: BookingStatus.ONGOING },
          getClientHint(request)
        );

        await createNotes({
          content: `**${user?.firstName?.trim()} ${user?.lastName?.trim()}** checked out asset with **[${
            booking.name
          }](/bookings/${booking.id})**.`,
          type: "UPDATE",
          userId: authSession.userId,
          assetIds: booking.assets.map((a) => a.id),
        });

        sendNotification({
          title: "Booking checked-out",
          message: "Your booking has been checked-out successfully",
          icon: { name: "success", variant: "success" },
          senderId: authSession.userId,
        });

        return json(data({ success: true }), {
          headers,
        });
      }
      case "checkIn": {
        const booking = await upsertBooking(
          {
            id,
            status: BookingStatus.COMPLETE,
          },
          getClientHint(request)
        );

        /** Create check-in notes for all assets */
        await createNotes({
          content: `**${user?.firstName?.trim()} ${user?.lastName?.trim()}** checked in asset with **[${
            booking.name
          }](/bookings/${booking.id})**.`,
          type: "UPDATE",
          userId: authSession.userId,
          assetIds: booking.assets.map((a) => a.id),
        });

        sendNotification({
          title: "Booking checked-in",
          message: "Your booking has been checked-in successfully",
          icon: { name: "success", variant: "success" },
          senderId: authSession.userId,
        });

        return json(data({ success: true }), {
          headers,
        });
      }
      case "archive": {
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

        return json(data({ success: true }), {
          headers,
        });
      }
      case "cancel": {
        const cancelledBooking = await upsertBooking(
          { id, status: BookingStatus.CANCELLED },
          getClientHint(request)
        );

        await createNotes({
          content: `**${user?.firstName?.trim()} ${user?.lastName?.trim()}** cancelled booking **[${
            cancelledBooking.name
          }](/bookings/${cancelledBooking.id})**.`,
          type: "UPDATE",
          userId: authSession.userId,
          assetIds: cancelledBooking.assets.map((a) => a.id),
        });

        sendNotification({
          title: "Booking canceled",
          message: "Your booking has been canceled successfully",
          icon: { name: "success", variant: "success" },
          senderId: authSession.userId,
        });

        return json(
          { success: true },
          {
            headers,
          }
        );
      }
      default: {
        checkExhaustiveSwitch(intent);
        return json(data(null));
      }
    }
  } catch (cause) {
    const reason = makeShelfError(cause, { userId, id });
    return json(error(reason), { status: reason.status });
  }
}

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
