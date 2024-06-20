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
import { db } from "~/database/db.server";
import { createNotes } from "~/modules/asset/service.server";
import {
  createNotesForBookingUpdate,
  deleteBooking,
  getBooking,
  getBookingFlags,
  removeAssets,
  sendBookingUpdateNotification,
  upsertBooking,
} from "~/modules/booking/service.server";
import { setSelectedOrganizationIdCookie } from "~/modules/organization/context.server";
import { getUserByID } from "~/modules/user/service.server";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";
import { checkExhaustiveSwitch } from "~/utils/check-exhaustive-switch";
import { getClientHint, getHints } from "~/utils/client-hints";
import {
  setCookie,
  updateCookieWithPerPage,
  userPrefs,
} from "~/utils/cookies.server";
import { sendNotification } from "~/utils/emitter/send-notification.server";
import { ShelfError, makeShelfError } from "~/utils/error";
import {
  data,
  error,
  getCurrentSearchParams,
  getParams,
  parseData,
} from "~/utils/http.server";
import { getParamsValues } from "~/utils/list";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.validator.server";
import { requirePermission } from "~/utils/roles.server";
import { bookingStatusColorMap } from "./bookings";

export async function loader({ context, request, params }: LoaderFunctionArgs) {
  const authSession = context.getSession();
  const { userId } = authSession;
  const { bookingId } = getParams(params, z.object({ bookingId: z.string() }), {
    additionalData: { userId },
  });

  const searchParams = getCurrentSearchParams(request);
  const paramsValues = getParamsValues(searchParams);
  const { page, perPageParam } = paramsValues;
  const cookie = await updateCookieWithPerPage(request, perPageParam);
  const { perPage } = cookie;
  /** Needed for getting the assets */
  const skip = page > 1 ? (page - 1) * perPage : 0;
  const take = perPage >= 1 && perPage <= 100 ? perPage : 20; // min 1 and max 100 per page

  try {
    const { organizationId, role } = await requirePermission({
      userId: authSession?.userId,
      request,
      entity: PermissionEntity.booking,
      action: PermissionAction.create,
    });

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

    /** For self service users, we only allow them to read their own bookings */
    if (isSelfService && booking.custodianUserId !== authSession.userId) {
      throw new ShelfError({
        cause: null,
        message: "You are not authorized to view this booking",
        status: 403,
        label: "Booking",
        shouldBeCaptured: false,
      });
    }

    const [teamMembers, org, assets, totalAssets, bookingFlags] =
      await Promise.all([
        /**
         * We need to fetch the team members to be able to display them in the custodian dropdown.
         */
        db.teamMember.findMany({
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
          skip,
          take,
          include: {
            category: true,
            custody: true,
            kit: true,
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
        /** Count assets them */
        db.asset.count({
          where: {
            id: {
              in: booking?.assets.map((a) => a.id) || [],
            },
          },
        }),
        /** We use pagination to show assets, so we have to calculate the status of booking considering all the assets of booking and not just single page */
        getBookingFlags({
          id: booking.id,
          assetIds: booking.assets.map((a) => a.id),
          from: booking.from,
          to: booking.to,
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
        booking,
        modelName,
        items: booking.assets,
        page,
        totalItems: totalAssets,
        perPage,
        totalPages: totalAssets / perPage,
        teamMembers,
        bookingFlags,
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
    const { intent, nameChangeOnly } = parseData(
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
          "removeKit",
        ]),
        nameChangeOnly: z
          .string()
          .optional()
          .transform((val) => (val === "yes" ? true : false)),
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
      removeKit: PermissionAction.update,
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
    const formData = await request.formData();

    switch (intent) {
      case "save":
      case "reserve":
      case "checkOut":
      case "checkIn":
        // What status to set based on the intent
        const intentToStatusMap = {
          save: undefined,
          reserve: BookingStatus.RESERVED,
          checkOut: BookingStatus.ONGOING,
          checkIn: BookingStatus.COMPLETE,
        };
        let upsertBookingData = {
          organizationId,
          id,
        };

        // We are only changing the name so we do things simpler
        if (nameChangeOnly) {
          const { name } = parseData(
            formData,
            z.object({
              name: z.string(),
            }),
            {
              additionalData: { userId, id, organizationId, role },
            }
          );
          Object.assign(upsertBookingData, {
            name,
          });
        } else {
          /** WE are updating the whole booking */
          const payload = parseData(
            formData,
            NewBookingFormSchema(false, false, getHints(request)), // If we are only changing the name, we are basically setting inputFieldIsDisabled && nameChangeOnly to true
            {
              additionalData: { userId, id, organizationId, role },
            }
          );

          const { name, custodian } = payload;

          const hints = getHints(request);
          const fmt = "yyyy-MM-dd'T'HH:mm";

          const from = DateTime.fromFormat(
            formData.get("startDate")!.toString()!,
            fmt,
            {
              zone: hints.timeZone,
            }
          ).toJSDate();

          const to = DateTime.fromFormat(
            formData.get("endDate")!.toString()!,
            fmt,
            {
              zone: hints.timeZone,
            }
          ).toJSDate();

          Object.assign(upsertBookingData, {
            custodianUserId: custodian?.userId,
            custodianTeamMemberId: custodian?.id,
            name,
            from,
            to,
          });
        }

        // Add the status if it exists
        Object.assign(upsertBookingData, {
          ...(intentToStatusMap[intent] && {
            status: intentToStatusMap[intent],
          }),
        });
        // Update and save the booking
        const booking = await upsertBooking(
          upsertBookingData,
          getClientHint(request),
          isSelfService
        );

        await createNotesForBookingUpdate(intent, booking, {
          firstName: user?.firstName || "",
          lastName: user?.lastName || "",
          id: authSession.userId,
        });

        sendBookingUpdateNotification(intent, authSession.userId);

        return json(data({ booking }), {
          headers,
        });

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
          formData,
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
        return json(
          { success: true },
          {
            headers,
          }
        );
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
      case "removeKit": {
        const { kitId } = parseData(formData, z.object({ kitId: z.string() }), {
          additionalData: { userId, id, organizationId, role },
        });

        const kit = await db.kit.findUniqueOrThrow({
          where: { id: kitId },
          select: { assets: { select: { id: true } } },
        });

        const b = await removeAssets({
          booking: { id, assetIds: kit.assets.map((a) => a.id) },
          firstName: user?.firstName || "",
          lastName: user?.lastName || "",
          userId: authSession.userId,
        });

        sendNotification({
          title: "Kit removed",
          message: "Your kit has been removed from the booking",
          icon: { name: "success", variant: "success" },
          senderId: authSession.userId,
        });

        return json(data({ booking: b }), {
          headers,
        });
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
  const { booking } = useLoaderData<typeof loader>();

  return (
    <>
      <Header
        title={hasName ? name : booking.name}
        subHeading={
          <div className="flex items-center gap-2">
            <Badge color={bookingStatusColorMap[booking.status]}>
              <span className="block lowercase first-letter:uppercase">
                {booking.status}
              </span>
            </Badge>
          </div>
        }
      />

      <div>
        <BookingPageContent />
        <ContextualModal />
      </div>
    </>
  );
}
