import { TagUseFor } from "@prisma/client";
import { json, redirect } from "@remix-run/node";
import type {
  ActionFunctionArgs,
  MetaFunction,
  LoaderFunctionArgs,
  LinksFunction,
} from "@remix-run/node";
import { Outlet, useMatches } from "@remix-run/react";
import { DateTime } from "luxon";
import { z } from "zod";
import { BulkRemoveAssetsAndKitSchema } from "~/components/booking/bulk-remove-asset-and-kit-dialog";
import { CheckinIntentEnum } from "~/components/booking/checkin-dialog";
import { CheckoutIntentEnum } from "~/components/booking/checkout-dialog";
import {
  BookingFormSchema,
  ExtendBookingSchema,
} from "~/components/booking/forms/forms-schema";
import { BookingPageContent } from "~/components/booking/page-content";
import { ErrorContent } from "~/components/errors";
import ContextualModal from "~/components/layout/contextual-modal";
import ContextualSidebar from "~/components/layout/contextual-sidebar";
import type { HeaderData } from "~/components/layout/header/types";

import { db } from "~/database/db.server";
import { hasGetAllValue } from "~/hooks/use-model-filters";
import {
  archiveBooking,
  cancelBooking,
  checkinAssets,
  checkinBooking,
  checkoutBooking,
  deleteBooking,
  extendBooking,
  getBooking,
  getBookingFlags,
  getDetailedPartialCheckinData,
  removeAssets,
  reserveBooking,
  revertBookingToDraft,
  updateBasicBooking,
} from "~/modules/booking/service.server";
import { calculatePartialCheckinProgress } from "~/modules/booking/utils.server";
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
import { sortBookingAssets } from "~/utils/booking-assets";
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
import { wrapLinkForNote, wrapUserLinkForNote } from "~/utils/markdoc-wrappers";
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
      action: PermissionAction.read,
    });

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
        orderBy: { name: "asc" },
      }),
    ]);
    // DEPRECATED for now
    //  * if the booking is ongoing and there is no status param, we need to set it to
    // checked-out as that is the default
    // * Only apply this redirect if we're on the main booking page, not child routes
    // */
    // const url = new URL(request.url);
    // const isMainBookingPage = url.pathname === `/bookings/${bookingId}`;

    // // Smart status param handling using helper function
    // const statusRedirect = getBookingStatusRedirect({
    //   bookingId,
    //   booking,
    //   currentStatusParam: searchParams.get("status"),
    //   isMainBookingPage,
    // });

    // if (statusRedirect) {
    //   return statusRedirect;
    // }

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

    // Check if there might be partial check-ins by looking at asset statuses OR booking status
    // We need to check both AVAILABLE assets (already partially checked in) AND
    // ONGOING/OVERDUE bookings (could have partial check-ins)
    const hasAvailableAssets = booking.assets.some(
      (asset) => asset.status === "AVAILABLE"
    );
    const canHavePartialCheckins = ["ONGOING", "OVERDUE"].includes(
      booking.status
    );

    // Fetch partial check-in data if there are already partial check-ins OR if the booking could have them
    const { checkedInAssetIds, partialCheckinDetails } =
      hasAvailableAssets || canHavePartialCheckins
        ? await getDetailedPartialCheckinData(booking.id)
        : { checkedInAssetIds: [] as string[], partialCheckinDetails: {} };

    // We'll compute alreadyBooked after fetching assetDetails with full bookings relation
    const enhancedBooking = booking;

    // Sort assets by booking context priority
    enhancedBooking.assets = sortBookingAssets(
      enhancedBooking.assets,
      partialCheckinDetails
    );

    // Group assets by kitId for pagination purposes
    const assetsByKit: Record<
      string,
      Array<(typeof enhancedBooking.assets)[0]>
    > = {};
    const individualAssets: Array<(typeof enhancedBooking.assets)[0]> = [];

    enhancedBooking.assets.forEach((asset) => {
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
      assets: Array<(typeof enhancedBooking.assets)[0]>;
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
                      OR: [
                        // Rule 1: RESERVED bookings always conflict
                        {
                          status: "RESERVED",
                          id: { not: booking.id }, // Exclude current booking from conflicts
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
                        },
                        // Rule 2: ONGOING/OVERDUE bookings (filtered by asset status in isAssetAlreadyBooked logic)
                        {
                          status: { in: ["ONGOING", "OVERDUE"] },
                          id: { not: booking.id }, // Exclude current booking from conflicts
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

    const assetCategories = enhancedBooking.assets
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

    // Calculate partial check-in progress
    // For progress calculation, we need the TOTAL number of assets in the booking,
    // not the filtered count from booking.assets (which may be filtered by status)
    // So we need to get the unfiltered asset count
    const totalBookingAssets = await db.asset.count({
      where: {
        bookings: {
          some: { id: booking.id },
        },
      },
    });

    const partialCheckinProgress = calculatePartialCheckinProgress(
      totalBookingAssets,
      checkedInAssetIds,
      booking.status
    );

    const modelName = {
      singular: "item",
      plural: "items",
    };

    const header: HeaderData = {
      title: `Edit | ${booking.name}`,
    };
    return json(
      data({
        userId,
        currentOrganization,
        header,
        booking: enhancedBooking,
        modelName,
        items: enrichedPaginatedItems,
        page,
        totalItems: totalPaginationItems,
        totalPaginationItems,
        perPage,
        totalPages,
        ...teamMembersData,
        bookingFlags,
        totalKits: Object.keys(assetsByKit).length,
        totalValue: calculateTotalValueOfAssets({
          assets: enhancedBooking.assets,
          currency: currentOrganization.currency,
          locale: getClientHint(request).locale,
        }),
        /** Assets inside the booking without kits */
        assetsCount: individualAssets.length,
        totalAssets: totalBookingAssets,
        allCategories,
        tags,
        totalTags: tags.length,
        partialCheckinProgress,
        partialCheckinDetails,
        // Asset search tooltip
        searchFieldLabel: "Search by asset name",
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
  name: "bookings.$bookingId.overview",
};

export type BookingPageActionData = typeof action;

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
    const formData = await request.formData();
    const { intent, checkoutIntentChoice, checkinIntentChoice } = parseData(
      formData,
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
          "partial-checkin",
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
      "partial-checkin": PermissionAction.checkin,
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
    // Form data is already extracted above and will be reused
    const basicBookingInfo = await db.booking.findUniqueOrThrow({
      where: { id },
      select: { id: true, status: true, from: true, to: true },
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
          userId,
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
          userId,
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
          from: basicBookingInfo.from,
          to: basicBookingInfo.to,
          userId: user.id,
        });

        const actor = wrapUserLinkForNote({
          id: userId,
          firstName: user?.firstName,
          lastName: user?.lastName,
        });
        const bookingLink = wrapLinkForNote(
          `/bookings/${booking.id}`,
          booking.name
        );
        await createNotes({
          content: `${actor} checked out assets with ${bookingLink}.`,
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
        // Extract specific asset IDs if provided (for enhanced completion messaging)
        const specificAssetIds = formData.getAll(
          "specificAssetIds[]"
        ) as string[];

        const booking = await checkinBooking({
          id,
          organizationId,
          hints: getClientHint(request),
          intentChoice: checkinIntentChoice,
          userId: user.id,
          specificAssetIds:
            specificAssetIds.length > 0 ? specificAssetIds : undefined,
        });

        const actor = wrapUserLinkForNote({
          id: userId,
          firstName: user?.firstName,
          lastName: user?.lastName,
        });
        const bookingLink = wrapLinkForNote(
          `/bookings/${booking.id}`,
          booking.name
        );
        await createNotes({
          content: `${actor} checked in assets with ${bookingLink}.`,
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

        return json(data({ booking, success: true }), {
          headers,
        });
      case "partial-checkin": {
        return await checkinAssets({
          formData,
          request,
          bookingId: id,
          organizationId,
          userId,
          authSession,
        });
      }
      case "delete": {
        if (isSelfServiceOrBase) {
          /**
           * When user is self_service we need to check if the booking belongs to them and only then allow them to delete it.
           * They have delete permissions but shouldnt be able to delete other people's bookings
           * Practically they should not be able to even view/access another booking but this is just an extra security measure
           */
          const b = await getBooking({ id, organizationId, request });
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

        const actor = wrapUserLinkForNote({
          id: userId,
          firstName: user?.firstName,
          lastName: user?.lastName,
        });
        const deletedBookingLink = wrapLinkForNote(
          `/bookings/${deletedBooking.id}`,
          deletedBooking.name.trim()
        );
        await createNotes({
          content: `${actor} deleted booking ${deletedBookingLink}.`,
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

        // Get the asset data for proper note generation
        const asset = await db.asset.findUnique({
          where: { id: assetId, organizationId },
          select: { id: true, title: true },
        });

        const b = await removeAssets({
          booking: { id, assetIds: [assetId as string] },
          firstName: user?.firstName || "",
          lastName: user?.lastName || "",
          userId,
          organizationId,
          assets: asset ? [asset] : [],
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
        await archiveBooking({ id, organizationId, userId: user.id });

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
          userId: user.id,
        });

        const actor = wrapUserLinkForNote({
          id: userId,
          firstName: user?.firstName,
          lastName: user?.lastName,
        });
        const cancelledBookingLink = wrapLinkForNote(
          `/bookings/${cancelledBooking.id}`,
          cancelledBooking.name.trim()
        );
        await createNotes({
          content: `${actor} cancelled booking ${cancelledBookingLink}.`,
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
          where: { id: kitId, organizationId },
          select: {
            id: true,
            name: true,
            assets: { select: { id: true } },
          },
        });

        const b = await removeAssets({
          booking: { id, assetIds: kit.assets.map((a) => a.id) },
          firstName: user?.firstName || "",
          lastName: user?.lastName || "",
          userId,
          kitIds: [kitId],
          kits: [{ id: kit.id, name: kit.name }],
          // Don't pass individual assets for note generation when removing a single kit
          // The assets parameter is used for note content, not for actual removal
          assets: [],
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
        await revertBookingToDraft({ id, organizationId, userId });

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

        const { endDate } = parseData(
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
          userId,
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
         * here we are separating them and excluding assets that belong to kits
         * */
        const assets = await db.asset.findMany({
          where: { id: { in: assetOrKitIds } },
          select: { id: true, title: true },
        });

        const kits = await db.kit.findMany({
          where: { id: { in: assetOrKitIds } },
          select: { id: true, name: true, assets: { select: { id: true } } },
        });

        // Get asset IDs that belong to the selected kits
        const kitAssetIds = kits.flatMap((kit) =>
          kit.assets.map((asset) => asset.id)
        );

        // Filter out assets that belong to the selected kits to avoid double-counting
        const standaloneAssets = assets.filter(
          (asset) => !kitAssetIds.includes(asset.id)
        );

        // All asset IDs to be disconnected (standalone assets + kit assets)
        const allAssetIdsToRemove = [
          ...standaloneAssets.map((a) => a.id),
          ...kitAssetIds,
        ];

        const b = await removeAssets({
          booking: { id, assetIds: allAssetIdsToRemove },
          kitIds: kits.map((k) => k.id),
          kits: kits.map((kit) => ({ id: kit.id, name: kit.name })),
          assets: standaloneAssets.map((asset) => ({
            id: asset.id,
            title: asset.title,
          })),
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
  const matches = useMatches();
  const currentRoute: RouteHandleWithName = matches[matches.length - 1];

  /**When we are on the booking.scan-assets route, we render an outlet */
  const shouldRenderOutlet = [
    "booking.overview.scan-assets",
    "booking.overview.checkin-assets",
  ].includes(currentRoute?.handle?.name);

  return shouldRenderOutlet ? (
    <Outlet />
  ) : (
    <div>
      <BookingPageContent />
      <ContextualModal />
      <ContextualSidebar />
    </div>
  );
}

export const ErrorBoundary = () => <ErrorContent />;
