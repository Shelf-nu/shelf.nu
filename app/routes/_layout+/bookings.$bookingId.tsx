import { BookingStatus, TagUseFor } from "@prisma/client";
import { json, redirect } from "@remix-run/node";
import type {
  ActionFunctionArgs,
  MetaFunction,
  LoaderFunctionArgs,
  LinksFunction,
} from "@remix-run/node";
import { Outlet, useLoaderData, useMatches } from "@remix-run/react";
import { useAtomValue } from "jotai";
import { DateTime } from "luxon";
import { z } from "zod";
import { dynamicTitleAtom } from "~/atoms/dynamic-title-atom";
import { BookingStatusBadge } from "~/components/booking/booking-status-badge";
import { BulkRemoveAssetsAndKitSchema } from "~/components/booking/bulk-remove-asset-and-kit-dialog";
import { CheckinIntentEnum } from "~/components/booking/checkin-dialog";
import { CheckoutIntentEnum } from "~/components/booking/checkout-dialog";
import {
  BookingFormSchema,
  ExtendBookingSchema,
} from "~/components/booking/forms/forms-schema";
import { BookingPageContent } from "~/components/booking/page-content";
import { TimeRemaining } from "~/components/booking/time-remaining";
import ContextualModal from "~/components/layout/contextual-modal";
import ContextualSidebar from "~/components/layout/contextual-sidebar";
import Header from "~/components/layout/header";
import type { HeaderData } from "~/components/layout/header/types";
import { Button } from "~/components/shared/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "~/components/shared/tooltip";
import { db } from "~/database/db.server";
import { useDisabled } from "~/hooks/use-disabled";
import { hasGetAllValue } from "~/hooks/use-model-filters";
import {
  archiveBooking,
  cancelBooking,
  checkinBooking,
  checkoutBooking,
  deleteBooking,
  extendBooking,
  getBooking,
  getBookingFlags,
  removeAssets,
  reserveBooking,
  revertBookingToDraft,
  updateBasicBooking,
} from "~/modules/booking/service.server";
import { getBookingSettingsForOrganization } from "~/modules/booking-settings/service.server";
import { createNotes } from "~/modules/note/service.server";
import { setSelectedOrganizationIdCookie } from "~/modules/organization/context.server";
import { buildTagsSet } from "~/modules/tag/service.server";
import { getTeamMemberForCustodianFilter } from "~/modules/team-member/service.server";
import type { RouteHandleWithName } from "~/modules/types";
import { getUserByID } from "~/modules/user/service.server";
import { getWorkingHoursForOrganization } from "~/modules/working-hours/service.server";
import bookingPageCss from "~/styles/booking.css?url";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";
import { calculateTotalValueOfAssets } from "~/utils/bookings";
import { checkExhaustiveSwitch } from "~/utils/check-exhaustive-switch";
import { getClientHint, getHints } from "~/utils/client-hints";
import { DATE_TIME_FORMAT } from "~/utils/constants";
import {
  setCookie,
  updateCookieWithPerPage,
  userPrefs,
} from "~/utils/cookies.server";
import { sendNotification } from "~/utils/emitter/send-notification.server";
import {
  ShelfError,
  isZodValidationError,
  makeShelfError,
} from "~/utils/error";
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
} from "~/utils/permissions/permission.data";
import { requirePermission } from "~/utils/roles.server";

export type BookingPageLoaderData = typeof loader;

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

  try {
    const {
      organizationId,
      isSelfServiceOrBase,
      currentOrganization,
      userOrganizations,
      canSeeAllBookings,
    } = await requirePermission({
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

    // Get the booking with basic asset information
    const [booking, tags] = await Promise.all([
      getBooking({
        id: bookingId,
        organizationId: organizationId,
        userOrganizations,
        request,
        extraInclude: {
          creator: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              profilePicture: true,
            },
          },
        },
      }),
      db.tag.findMany({
        where: {
          organizationId,
          OR: [
            { useFor: { isEmpty: true } },
            { useFor: { has: TagUseFor.BOOKING } },
          ],
        },
      }),
    ]);

    /** For self service & base users, we only allow them to read their own bookings */
    if (!canSeeAllBookings && booking.custodianUserId !== authSession.userId) {
      throw new ShelfError({
        cause: null,
        message: "You are not authorized to view this booking",
        status: 403,
        label: "Booking",
        shouldBeCaptured: false,
      });
    }

    // Group assets by kitId for pagination purposes
    const assetsByKit: Record<string, Array<(typeof booking.assets)[0]>> = {};
    const individualAssets: Array<(typeof booking.assets)[0]> = [];

    booking.assets.forEach((asset) => {
      if (asset.kitId) {
        if (!assetsByKit[asset.kitId]) {
          assetsByKit[asset.kitId] = [];
        }
        assetsByKit[asset.kitId].push(asset);
      } else {
        individualAssets.push(asset);
      }
    });

    // Create pagination items where each kit or individual asset is one item
    const paginationItems: Array<{
      type: "kit" | "asset";
      id: string;
      assets: Array<(typeof booking.assets)[0]>;
    }> = [
      ...Object.entries(assetsByKit).map(([kitId, assets]) => ({
        type: "kit" as const,
        id: kitId,
        assets,
      })),
      ...individualAssets.map((asset) => ({
        type: "asset" as const,
        id: asset.id,
        assets: [asset],
      })),
    ];

    // Calculate pagination
    const totalPaginationItems = paginationItems.length;
    const totalPages = Math.ceil(totalPaginationItems / perPage);
    const skip = page > 1 ? (page - 1) * perPage : 0;
    const paginatedItems = paginationItems.slice(skip, skip + perPage);

    // Get all asset IDs from the current pagination page
    const assetIdsToFetch = paginatedItems.flatMap((item) =>
      item.assets.map((asset) => asset.id)
    );

    // Execute all necessary queries in parallel
    const [teamMembersData, assetDetails, bookingFlags, kits] =
      await Promise.all([
        /**
         * We need to fetch the team members to be able to display them in the custodian dropdown.
         */
        getTeamMemberForCustodianFilter({
          organizationId,
          getAll:
            searchParams.has("getAll") &&
            hasGetAllValue(searchParams, "teamMember"),
          selectedTeamMembers: booking.custodianTeamMemberId
            ? [booking.custodianTeamMemberId]
            : [],
          filterByUserId: isSelfServiceOrBase, // If the user is self service or base, they can only see their own. Also if the booking status is not draft, we dont need to load teammembers as the select is disabled. An improvement can be done that if the booking is not draft, we dont need to loading any other teamMember than the currently assigned one
          userId,
        }),

        /**
         * Get detailed asset information with bookings for the paginated assets
         */
        db.asset.findMany({
          where: {
            id: { in: assetIdsToFetch },
          },
          include: {
            category: true,
            custody: true,
            kit: true,
            bookings: {
              where: {
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

        /** Calculate booking flags considering all assets */
        getBookingFlags({
          id: booking.id,
          assetIds: booking.assets.map((a) => a.id),
          from: booking.from,
          to: booking.to,
        }),

        /** Get kit details for the kits in the current page */
        db.kit.findMany({
          where: {
            id: {
              in: paginatedItems
                .filter((item) => item.type === "kit")
                .map((item) => item.id),
            },
          },
          include: {
            category: {
              select: {
                id: true,
                name: true,
                color: true,
              },
            },
            _count: { select: { assets: true } },
          },
        }),
      ]);

    // Create maps for easy lookup
    const assetDetailsMap = new Map(
      assetDetails.map((asset) => [asset.id, asset])
    );
    const kitsMap = new Map(kits.map((kit) => [kit.id, kit]));

    // Enrich the paginated items with full asset details
    const enrichedPaginatedItems = paginatedItems.map((item) => ({
      ...item,
      assets: item.assets.map((asset) => {
        const details = assetDetailsMap.get(asset.id);
        return details || asset;
      }),
      kit: item.type === "kit" ? kitsMap.get(item.id) : null,
    }));

    const assetCategories = booking.assets
      .map((asset) => asset.category)
      .filter((category) => category !== null && category !== undefined)
      .filter(
        (category, index, self) =>
          // Find the index of the first occurrence of this category ID
          index === self.findIndex((c) => c.id === category.id)
      );
    const kitCategories = kits
      .map((kit) => kit.category)
      .filter((category) => category !== null && category !== undefined)
      .filter(
        (category, index, self) =>
          // Find the index of the first occurrence of this category ID
          index === self.findIndex((c) => c.id === category.id)
      );

    const allCategories = [...assetCategories, ...kitCategories];

    const modelName = {
      singular: "asset",
      plural: "assets",
    };

    const header: HeaderData = {
      title: `Edit | ${booking.name}`,
    };
    return json(
      data({
        userId,
        currentOrganization,
        header,
        booking,
        modelName,
        paginatedItems: enrichedPaginatedItems,
        page,
        totalItems: totalPaginationItems,
        totalPaginationItems,
        perPage,
        totalPages,
        ...teamMembersData,
        bookingFlags,
        totalKits: Object.keys(assetsByKit).length,
        totalValue: calculateTotalValueOfAssets({
          assets: booking.assets,
          currency: currentOrganization.currency,
          locale: getClientHint(request).locale,
        }),
        /** Assets inside the booking without kits */
        assetsCount: individualAssets.length,
        allCategories,
        tags,
        totalTags: tags.length,
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

export const links: LinksFunction = () => [
  {
    rel: "stylesheet",
    href: bookingPageCss,
  },
];

export const handle = {
  breadcrumb: () => "single",
  name: "bookings.$bookingId",
};

export type BookingPageActionData = typeof action;

export async function action({ context, request, params }: ActionFunctionArgs) {
  const { userId } = context.getSession();
  const { bookingId: id } = getParams(
    params,
    z.object({ bookingId: z.string() }),
    {
      additionalData: { userId },
    }
  );

  try {
    const { intent, checkoutIntentChoice, checkinIntentChoice } = parseData(
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
          "revert-to-draft",
          "extend-booking",
          "bulk-remove-asset-or-kit",
        ]),
        nameChangeOnly: z
          .string()
          .optional()
          .transform((val) => (val === "yes" ? true : false)),
        checkoutIntentChoice: z.nativeEnum(CheckoutIntentEnum).optional(),
        checkinIntentChoice: z.nativeEnum(CheckinIntentEnum).optional(),
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
      "revert-to-draft": PermissionAction.update,
      "extend-booking": PermissionAction.update,
      "bulk-remove-asset-or-kit": PermissionAction.update,
    };

    const { organizationId, role, isSelfServiceOrBase } =
      await requirePermission({
        userId,
        request,
        entity: PermissionEntity.booking,
        action: intent2ActionMap[intent],
      });

    const user = await getUserByID(userId);

    const headers = [
      setCookie(await setSelectedOrganizationIdCookie(organizationId)),
    ];
    const formData = await request.formData();
    const basicBookingInfo = await db.booking.findUniqueOrThrow({
      where: { id },
      select: { id: true, status: true },
    });
    const workingHours = await getWorkingHoursForOrganization(organizationId);
    const bookingSettings =
      await getBookingSettingsForOrganization(organizationId);
    switch (intent) {
      case "save": {
        const hints = getHints(request);
        const payload = parseData(
          formData,
          BookingFormSchema({
            action: "save",
            status: basicBookingInfo.status,
            hints,
            workingHours,
            bookingSettings,
          }),
          {
            additionalData: { userId, id, organizationId, role },
          }
        );

        const from = formData.get("startDate");
        const to = formData.get("endDate");

        const formattedFrom = from
          ? DateTime.fromFormat(from.toString(), DATE_TIME_FORMAT, {
              zone: hints.timeZone,
            }).toJSDate()
          : undefined;

        const formattedTo = to
          ? DateTime.fromFormat(to.toString(), DATE_TIME_FORMAT, {
              zone: hints.timeZone,
            }).toJSDate()
          : undefined;

        const tags = buildTagsSet(payload.tags).set;

        const booking = await updateBasicBooking({
          id,
          organizationId,
          name: payload.name,
          description: payload.description,
          from: formattedFrom,
          to: formattedTo,
          custodianUserId: payload.custodian?.userId,
          custodianTeamMemberId: payload.custodian?.id,
          tags,
        });

        sendNotification({
          title: "Booking saved",
          message: "Your booking has been saved successfully",
          icon: { name: "success", variant: "success" },
          senderId: userId,
        });

        return json(data({ booking }), {
          headers,
        });
      }
      case "reserve": {
        const hints = getHints(request);

        const payload = parseData(
          formData,
          BookingFormSchema({
            hints,
            action: "reserve",
            status: basicBookingInfo.status,
            workingHours,
            bookingSettings,
          }),
          {
            additionalData: { userId, id, organizationId, role },
          }
        );

        const from = formData.get("startDate");
        const to = formData.get("endDate");
        const tags = buildTagsSet(payload.tags).set;

        const formattedFrom = from
          ? DateTime.fromFormat(from.toString(), DATE_TIME_FORMAT, {
              zone: hints.timeZone,
            }).toJSDate()
          : undefined;

        const formattedTo = to
          ? DateTime.fromFormat(to.toString(), DATE_TIME_FORMAT, {
              zone: hints.timeZone,
            }).toJSDate()
          : undefined;

        const booking = await reserveBooking({
          id,
          organizationId,
          name: payload.name,
          description: payload.description,
          from: formattedFrom,
          to: formattedTo,
          custodianUserId: payload.custodian?.userId,
          custodianTeamMemberId: payload.custodian?.id,
          hints: getClientHint(request),
          isSelfServiceOrBase,
          tags,
        });

        sendNotification({
          title: "Booking reserved",
          message: "Your booking has been reserved successfully",
          icon: { name: "success", variant: "success" },
          senderId: userId,
        });

        return json(data({ booking }), {
          headers,
        });
      }
      case "checkOut": {
        const booking = await checkoutBooking({
          id,
          organizationId,
          hints: getClientHint(request),
          intentChoice: checkoutIntentChoice,
        });

        await createNotes({
          content: `**${user?.firstName?.trim()} ${user?.lastName?.trim()}** checked out asset with **[${
            booking.name
          }](/bookings/${booking.id})**.`,
          type: "UPDATE",
          userId: user.id,
          assetIds: booking.assets.map((a) => a.id),
        });

        sendNotification({
          title: "Booking checked-out",
          message: "Your booking has been checked-out successfully",
          icon: { name: "success", variant: "success" },
          senderId: userId,
        });

        return json(data({ booking }), {
          headers,
        });
      }
      case "checkIn":
        const booking = await checkinBooking({
          id,
          organizationId,
          hints: getClientHint(request),
          intentChoice: checkinIntentChoice,
        });

        await createNotes({
          content: `**${user?.firstName?.trim()} ${user?.lastName?.trim()}** checked in asset with **[${
            booking.name
          }](/bookings/${booking.id})**.`,
          type: "UPDATE",
          userId: user.id,
          assetIds: booking.assets.map((a) => a.id),
        });

        sendNotification({
          title: "Booking checked-in",
          message: "Your booking has been checked-in successfully",
          icon: { name: "success", variant: "success" },
          senderId: userId,
        });

        return json(data({ booking }), {
          headers,
        });

      case "delete": {
        if (isSelfServiceOrBase) {
          /**
           * When user is self_service we need to check if the booking belongs to them and only then allow them to delete it.
           * They have delete permissions but shouldnt be able to delete other people's bookings
           * Practically they should not be able to even view/access another booking but this is just an extra security measure
           */
          const b = await getBooking({ id, organizationId });
          if (b?.creatorId !== userId && b?.custodianUserId !== userId) {
            throw new ShelfError({
              cause: null,
              message: "You are not authorized to delete this booking",
              status: 403,
              label: "Booking",
            });
          }
        }

        const deletedBooking = await deleteBooking(
          { id, organizationId },
          getClientHint(request)
        );

        await createNotes({
          content: `**${user?.firstName?.trim()} ${user?.lastName?.trim()}** deleted booking **${
            deletedBooking.name
          }**.`,
          type: "UPDATE",
          userId: userId,
          assetIds: deletedBooking.assets.map((a) => a.id),
        });

        sendNotification({
          title: "Booking deleted",
          message: "Your booking has been deleted successfully",
          icon: { name: "trash", variant: "error" },
          senderId: userId,
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
          userId,
          organizationId,
        });

        sendNotification({
          title: "Asset removed",
          message: "Your asset has been removed from the booking",
          icon: { name: "success", variant: "success" },
          senderId: userId,
        });

        return json(data({ booking: b }), {
          headers,
        });
      }
      case "archive": {
        await archiveBooking({ id, organizationId });

        sendNotification({
          title: "Booking archived",
          message: "Your booking has been archived successfully",
          icon: { name: "success", variant: "success" },
          senderId: userId,
        });

        return json(data({ success: true }), { headers });
      }
      case "cancel": {
        const cancelledBooking = await cancelBooking({
          id,
          organizationId,
          hints: getClientHint(request),
        });

        await createNotes({
          content: `**${user?.firstName?.trim()} ${user?.lastName?.trim()}** cancelled booking **[${
            cancelledBooking.name
          }](/bookings/${cancelledBooking.id})**.`,
          type: "UPDATE",
          userId,
          assetIds: cancelledBooking.assets.map((a) => a.id),
        });

        sendNotification({
          title: "Booking canceled",
          message: "Your booking has been canceled successfully",
          icon: { name: "success", variant: "success" },
          senderId: userId,
        });

        return json(data({ success: true }), {
          headers,
        });
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
          userId,
          organizationId,
        });

        sendNotification({
          title: "Kit removed",
          message: "Your kit has been removed from the booking",
          icon: { name: "success", variant: "success" },
          senderId: userId,
        });

        return json(data({ booking: b }), {
          headers,
        });
      }
      case "revert-to-draft": {
        await revertBookingToDraft({ id, organizationId });

        sendNotification({
          title: "Booking reverted",
          message: "Your booking has been reverted back to draft successfully",
          icon: { name: "success", variant: "success" },
          senderId: userId,
        });

        return json(data({ success: true }));
      }
      case "extend-booking": {
        const hints = getClientHint(request);
        
        // Debug: Check what's actually in the form data
        console.log("=== EXTEND BOOKING DEBUG ===");
        console.log("FormData entries:", Object.fromEntries(formData));
        
        const { startDate, endDate } = parseData(
          formData,
          ExtendBookingSchema({
            workingHours,
            timeZone: hints.timeZone,
            bookingSettings,
          }),
          {
            additionalData: { userId, organizationId },
          }
        );

        const newEndDate = DateTime.fromFormat(endDate, DATE_TIME_FORMAT, {
          zone: hints.timeZone,
        }).toJSDate();

        await extendBooking({
          id,
          organizationId,
          hints,
          newEndDate,
        });

        sendNotification({
          title: "Booking extended",
          message: "Your booking has been extended to new end date.",
          icon: { name: "success", variant: "success" },
          senderId: userId,
        });

        return json(data({ success: true }));
      }
      case "bulk-remove-asset-or-kit": {
        const { assetOrKitIds } = parseData(
          formData,
          BulkRemoveAssetsAndKitSchema
        );

        /**
         * From frontend, we get both assetIds and kitIds,
         * here we are separating them
         * */
        const assetIds = await db.asset.findMany({
          where: { id: { in: assetOrKitIds } },
          select: { id: true },
        });

        const kitIds = await db.kit.findMany({
          where: { id: { in: assetOrKitIds } },
          select: { id: true },
        });

        const b = await removeAssets({
          booking: { id, assetIds: assetIds.map((a) => a.id) },
          kitIds: kitIds.map((k) => k.id),
          firstName: user?.firstName || "",
          lastName: user?.lastName || "",
          userId,
          organizationId,
        });

        sendNotification({
          title: "Kit removed",
          message: "Your kit has been removed from the booking",
          icon: { name: "success", variant: "success" },
          senderId: userId,
        });

        return json(data({ booking: b, success: true }), { headers });
      }
      default: {
        checkExhaustiveSwitch(intent);
        return json(data(null));
      }
    }
  } catch (cause) {
    const reason = makeShelfError(
      cause,
      { userId, id },
      !isZodValidationError(cause)
    );
    return json(error(reason), { status: reason.status });
  }
}

export default function BookingPage() {
  const name = useAtomValue(dynamicTitleAtom);
  const hasName = name !== "";
  const { booking } = useLoaderData<typeof loader>();
  const matches = useMatches();
  const currentRoute: RouteHandleWithName = matches[matches.length - 1];

  /**When we are on the booking.scan-assets route, we render an outlet */
  const shouldRenderOutlet =
    currentRoute?.handle?.name === "booking.scan-assets";

  return shouldRenderOutlet ? (
    <Outlet />
  ) : (
    <div className="relative">
      <Header
        title={hasName ? name : booking.name}
        subHeading={
          <div
            key={booking.status}
            className="mt-1 flex flex-col items-start gap-2 md:flex-row md:items-center"
          >
            <BookingStatusBadge
              status={booking.status}
              custodianUserId={booking.custodianUserId || undefined}
            />
            <TimeRemaining
              from={booking.from!}
              to={booking.to!}
              status={booking.status}
            />
          </div>
        }
        slots={{
          "right-of-title": <AddToCalendar />,
        }}
      />

      <div>
        <BookingPageContent />
        <ContextualModal />
        <ContextualSidebar />
      </div>
    </div>
  );
}

const AddToCalendar = () => {
  const disabled = useDisabled();
  const { booking } = useLoaderData<typeof loader>();
  const isArchived = booking.status === BookingStatus.ARCHIVED;
  return (
    <div className="absolute right-4 top-3">
      <TooltipProvider delayDuration={100}>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              to={`cal.ics`}
              download={true}
              reloadDocument={true}
              disabled={disabled || isArchived}
              variant="secondary"
              icon="calendar"
              className={"whitespace-nowrap"}
            >
              Add to calendar
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            <p className="text-xs">
              {disabled
                ? "Not possible to add to calendar due to booking status"
                : "Download this booking as a calendar event"}
            </p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    </div>
  );
};
