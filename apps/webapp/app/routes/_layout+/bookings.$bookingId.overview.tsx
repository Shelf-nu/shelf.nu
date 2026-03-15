import { BookingStatus, TagUseFor, OrganizationRoles } from "@shelf/database";
import { DateTime } from "luxon";
import type {
  ActionFunctionArgs,
  LinksFunction,
  LoaderFunctionArgs,
  MetaFunction,
} from "react-router";
import { Outlet, useMatches, data, redirect } from "react-router";
import { z } from "zod";
import { BulkRemoveAssetsAndKitSchema } from "~/components/booking/bulk-remove-asset-and-kit-dialog";
import { CheckinIntentEnum } from "~/components/booking/checkin-dialog";
import { CheckoutIntentEnum } from "~/components/booking/checkout-dialog";
import {
  BookingFormSchema,
  CancelBookingSchema,
  ExtendBookingSchema,
} from "~/components/booking/forms/forms-schema";
import { BookingPageContent } from "~/components/booking/page-content";
import { ErrorContent } from "~/components/errors";
import ContextualModal from "~/components/layout/contextual-modal";
import ContextualSidebar from "~/components/layout/contextual-sidebar";
import type { HeaderData } from "~/components/layout/header/types";

import { db } from "~/database/db.server";
import {
  findUnique,
  findUniqueOrThrow,
  findMany,
} from "~/database/query-helpers.server";
import { queryRaw, sql } from "~/database/sql.server";
import { hasGetAllValue } from "~/hooks/use-model-filters";
import { sendBookingUpdatedEmail } from "~/modules/booking/email-helpers";
import { groupAndSortAssetsByKit } from "~/modules/booking/helpers";
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
import { TAG_WITH_COLOR_SELECT } from "~/modules/tag/constants";
import { buildTagsSet } from "~/modules/tag/service.server";
import {
  getTeamMemberForCustodianFilter,
  getTeamMemberForForm,
} from "~/modules/team-member/service.server";
import type { RouteHandleWithName } from "~/modules/types";
import { getUserByID } from "~/modules/user/service.server";
import { getWorkingHoursForOrganization } from "~/modules/working-hours/service.server";
import bookingPageCss from "~/styles/booking.css?url";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";
import { sortBookingAssets } from "~/utils/booking-assets";
import { validateBookingOwnership } from "~/utils/booking-authorization.server";
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
  payload,
  error,
  getCurrentSearchParams,
  getParams,
  parseData,
} from "~/utils/http.server";
import { getParamsValues } from "~/utils/list";
import { logMissingFormIntent } from "~/utils/logger";
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
  const { page, perPageParam, orderDirection } = paramsValues;
  // Default to "status" for booking assets (getParamsValues defaults to "createdAt" which isn't valid here)
  const orderBy =
    paramsValues.orderBy === "createdAt" ? "status" : paramsValues.orderBy;

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
      queryRaw<{
        id: string;
        name: string;
        color: string | null;
        organizationId: string;
        useFor: string[];
        createdAt: string;
        updatedAt: string;
      }>(
        db,
        sql`SELECT * FROM "Tag" WHERE "organizationId" = ${organizationId} AND (array_length("useFor", 1) IS NULL OR ${TagUseFor.BOOKING} = ANY("useFor")) ORDER BY "name" ASC`
      ),
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

    // Only apply sortBookingAssets for status sorting to get partial check-in date ordering
    // For other sort options, the database orderBy is sufficient
    const isStatusSort = !orderBy || orderBy === "status";
    if (isStatusSort) {
      enhancedBooking.assets = sortBookingAssets(
        enhancedBooking.assets,
        partialCheckinDetails
      );
    }

    // Use helper to group assets by kit and sort them
    const sortedAssets = groupAndSortAssetsByKit(
      enhancedBooking.assets,
      orderBy,
      orderDirection
    );

    // Convert sorted assets to pagination items (kits grouped, individual assets separate)
    const paginationItems: Array<{
      type: "kit" | "asset";
      id: string;
      assets: Array<(typeof enhancedBooking.assets)[0]>;
    }> = [];

    const processedKitIds = new Set<string>();
    for (const asset of sortedAssets) {
      if (asset.kitId && asset.kit) {
        // Kit asset - group with other assets from same kit
        if (!processedKitIds.has(asset.kitId)) {
          processedKitIds.add(asset.kitId);
          const kitAssets = sortedAssets.filter((a) => a.kitId === asset.kitId);
          paginationItems.push({
            type: "kit",
            id: asset.kitId,
            assets: kitAssets,
          });
        }
      } else {
        // Individual asset
        paginationItems.push({
          type: "asset",
          id: asset.id,
          assets: [asset],
        });
      }
    }

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
    const [
      teamMembersData,
      teamMembersForFormData,
      assetDetails,
      bookingFlags,
      kits,
    ] = await Promise.all([
      /**
       * We need to fetch the team members for the custodian filter in sidebar.
       */
      getTeamMemberForCustodianFilter({
        organizationId,
        getAll:
          searchParams.has("getAll") &&
          hasGetAllValue(searchParams, "teamMember"),
        selectedTeamMembers: booking.custodianTeamMemberId
          ? [booking.custodianTeamMemberId]
          : [],
        filterByUserId: isSelfServiceOrBase,
        userId,
      }),

      // Team members for booking form - includes custodian based on booking status
      getTeamMemberForForm({
        organizationId,
        userId,
        isSelfServiceOrBase,
        custodianUserId: booking.custodianUserId || undefined,
        custodianTeamMemberId: booking.custodianTeamMemberId || undefined,
        bookingStatus: booking.status,
        getAll:
          searchParams.has("getAll") &&
          hasGetAllValue(searchParams, "teamMember"),
      }),

      /**
       * Get detailed asset information with bookings for the paginated assets.
       * Uses multiple queryRaw calls to replicate the Prisma include behavior.
       */
      (async () => {
        if (assetIdsToFetch.length === 0) return [];

        // Fetch base asset data with category, custody, and kit via joins
        const assets = await queryRaw<{
          id: string;
          title: string;
          description: string | null;
          status: string;
          mainImage: string | null;
          mainImageExpiration: string | null;
          organizationId: string;
          kitId: string | null;
          categoryId: string | null;
          availableToBook: boolean;
          createdAt: string;
          updatedAt: string;
          // Category fields (prefixed)
          cat_id: string | null;
          cat_name: string | null;
          cat_description: string | null;
          cat_color: string | null;
          cat_organizationId: string | null;
          cat_createdAt: string | null;
          cat_updatedAt: string | null;
          // Kit fields (prefixed)
          kit_id: string | null;
          kit_name: string | null;
          kit_description: string | null;
          kit_status: string | null;
          kit_image: string | null;
          kit_imageExpiration: string | null;
          kit_organizationId: string | null;
          kit_categoryId: string | null;
          kit_createdAt: string | null;
          kit_updatedAt: string | null;
          // Custody fields
          custody_id: string | null;
          custody_assetId: string | null;
          custody_custodianId: string | null;
          custody_createdAt: string | null;
          custody_updatedAt: string | null;
        }>(
          db,
          sql`SELECT a.*,
            c."id" as "cat_id", c."name" as "cat_name", c."description" as "cat_description",
            c."color" as "cat_color", c."organizationId" as "cat_organizationId",
            c."createdAt" as "cat_createdAt", c."updatedAt" as "cat_updatedAt",
            k."id" as "kit_id", k."name" as "kit_name", k."description" as "kit_description",
            k."status" as "kit_status", k."image" as "kit_image", k."imageExpiration" as "kit_imageExpiration",
            k."organizationId" as "kit_organizationId", k."categoryId" as "kit_categoryId",
            k."createdAt" as "kit_createdAt", k."updatedAt" as "kit_updatedAt",
            cu."id" as "custody_id", cu."assetId" as "custody_assetId",
            cu."custodianId" as "custody_custodianId",
            cu."createdAt" as "custody_createdAt", cu."updatedAt" as "custody_updatedAt"
          FROM "Asset" a
          LEFT JOIN "Category" c ON a."categoryId" = c."id"
          LEFT JOIN "Kit" k ON a."kitId" = k."id"
          LEFT JOIN "Custody" cu ON cu."assetId" = a."id"
          WHERE a."id" = ANY(${assetIdsToFetch}::text[])`
        );

        // Fetch tags for these assets
        const tagRows = await queryRaw<{
          assetId: string;
          tagId: string;
          tag_id: string;
          tag_name: string;
          tag_color: string | null;
        }>(
          db,
          sql`SELECT at."A" as "assetId", at."B" as "tagId",
            t."id" as "tag_id", t."name" as "tag_name", t."color" as "tag_color"
          FROM "_AssetToTag" at
          JOIN "Tag" t ON at."B" = t."id"
          WHERE at."A" = ANY(${assetIdsToFetch}::text[])`
        );

        // Build tag map: assetId -> tags[]
        const tagMap = new Map<
          string,
          { id: string; name: string; color: string | null }[]
        >();
        for (const row of tagRows) {
          const tags = tagMap.get(row.assetId) || [];
          tags.push({
            id: row.tag_id,
            name: row.tag_name,
            color: row.tag_color,
          });
          tagMap.set(row.assetId, tags);
        }

        // Fetch conflicting bookings for these assets (if booking has date range)
        let bookingMap = new Map<string, any[]>();
        if (booking.from && booking.to) {
          const conflictingBookings = await queryRaw<{
            assetId: string;
            id: string;
            name: string;
            status: string;
            from: string | null;
            to: string | null;
          }>(
            db,
            sql`SELECT ab."A" as "assetId", b."id", b."name", b."status", b."from", b."to"
            FROM "_AssetToBooking" ab
            JOIN "Booking" b ON ab."B" = b."id"
            WHERE ab."A" = ANY(${assetIdsToFetch}::text[])
              AND b."id" != ${booking.id}
              AND b."status" IN ('RESERVED', 'ONGOING', 'OVERDUE')
              AND (
                (b."from" <= ${booking.to} AND b."to" >= ${booking.from})
                OR (b."from" >= ${booking.from} AND b."to" <= ${booking.to})
              )`
          );
          for (const row of conflictingBookings) {
            const bookings = bookingMap.get(row.assetId) || [];
            bookings.push({
              id: row.id,
              name: row.name,
              status: row.status,
              from: row.from,
              to: row.to,
            });
            bookingMap.set(row.assetId, bookings);
          }
        }

        // Assemble the result in the same shape as the Prisma include
        return assets.map((a) => ({
          id: a.id,
          title: a.title,
          description: a.description,
          status: a.status,
          mainImage: a.mainImage,
          mainImageExpiration: a.mainImageExpiration,
          organizationId: a.organizationId,
          kitId: a.kitId,
          categoryId: a.categoryId,
          availableToBook: a.availableToBook,
          createdAt: a.createdAt,
          updatedAt: a.updatedAt,
          category: a.cat_id
            ? {
                id: a.cat_id,
                name: a.cat_name,
                description: a.cat_description,
                color: a.cat_color,
                organizationId: a.cat_organizationId,
                createdAt: a.cat_createdAt,
                updatedAt: a.cat_updatedAt,
              }
            : null,
          kit: a.kit_id
            ? {
                id: a.kit_id,
                name: a.kit_name,
                description: a.kit_description,
                status: a.kit_status,
                image: a.kit_image,
                imageExpiration: a.kit_imageExpiration,
                organizationId: a.kit_organizationId,
                categoryId: a.kit_categoryId,
                createdAt: a.kit_createdAt,
                updatedAt: a.kit_updatedAt,
              }
            : null,
          custody: a.custody_id
            ? {
                id: a.custody_id,
                assetId: a.custody_assetId,
                custodianId: a.custody_custodianId,
                createdAt: a.custody_createdAt,
                updatedAt: a.custody_updatedAt,
              }
            : null,
          tags: tagMap.get(a.id) || [],
          bookings: bookingMap.get(a.id) || [],
        }));
      })(),

      /** Calculate booking flags considering all assets */
      getBookingFlags({
        id: booking.id,
        assetIds: booking.assets.map((a) => a.id),
        from: booking.from,
        to: booking.to,
      }),

      /** Get kit details for the kits in the current page */
      (async () => {
        const kitIds = paginatedItems
          .filter((item) => item.type === "kit")
          .map((item) => item.id);
        if (kitIds.length === 0) return [];

        const rows = await queryRaw<{
          id: string;
          name: string;
          description: string | null;
          status: string;
          image: string | null;
          imageExpiration: string | null;
          organizationId: string;
          categoryId: string | null;
          createdAt: string;
          updatedAt: string;
          cat_id: string | null;
          cat_name: string | null;
          cat_color: string | null;
          assetCount: number;
        }>(
          db,
          sql`SELECT k.*,
            c."id" as "cat_id", c."name" as "cat_name", c."color" as "cat_color",
            (SELECT COUNT(*)::int FROM "Asset" a WHERE a."kitId" = k."id") as "assetCount"
          FROM "Kit" k
          LEFT JOIN "Category" c ON k."categoryId" = c."id"
          WHERE k."id" = ANY(${kitIds}::text[])`
        );

        return rows.map((r) => ({
          id: r.id,
          name: r.name,
          description: r.description,
          status: r.status,
          image: r.image,
          imageExpiration: r.imageExpiration,
          organizationId: r.organizationId,
          categoryId: r.categoryId,
          createdAt: r.createdAt,
          updatedAt: r.updatedAt,
          category: r.cat_id
            ? { id: r.cat_id, name: r.cat_name, color: r.cat_color }
            : null,
          _count: { assets: r.assetCount },
        }));
      })(),
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
    const [{ count: totalBookingAssets }] = await queryRaw<{ count: number }>(
      db,
      sql`SELECT COUNT(*)::int as "count" FROM "Asset" a JOIN "_AssetToBooking" ab ON ab."A" = a."id" WHERE ab."B" = ${booking.id}`
    );

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

    // Always use teamMembersForForm from getTeamMemberForForm - it handles all cases correctly
    const teamMembersForForm = teamMembersForFormData.teamMembers;

    return data(
      payload({
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
        teamMembersForForm,
        bookingFlags,
        totalKits: paginationItems.filter((item) => item.type === "kit").length,
        totalValue: calculateTotalValueOfAssets({
          assets: enhancedBooking.assets,
          currency: currentOrganization.currency,
          locale: getClientHint(request).locale,
        }),
        /** Assets inside the booking without kits */
        assetsCount: paginationItems.filter((item) => item.type === "asset")
          .length,
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
    throw data(error(reason), { status: reason.status });
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
    logMissingFormIntent({ formData, request, bookingId: id, userId });
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
      "extend-booking": PermissionAction.extend,
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

    // ADMIN/OWNER users bypass time restrictions (bufferStartTime, maxBookingLength)
    const isAdminOrOwner = !isSelfServiceOrBase;

    const user = await getUserByID(userId, {
      select: {
        id: true,
        firstName: true,
        lastName: true,
      } satisfies Record<string, any>,
    });

    const headers = [
      setCookie(await setSelectedOrganizationIdCookie(organizationId)),
    ];

    /**
     * Handle delete before fetching booking info.
     * The booking may already be deleted (double-click, concurrent request),
     * so we must not call findUniqueOrThrow before this.
     */
    if (intent === "delete") {
      if (isSelfServiceOrBase) {
        /**
         * When user is self_service we need to check if the booking belongs to them and only then allow them to delete it.
         * They have delete permissions but shouldnt be able to delete other people's bookings
         * Practically they should not be able to even view/access another booking but this is just an extra security measure
         */
        const b = await getBooking({ id, organizationId, request });
        validateBookingOwnership({
          booking: b,
          userId,
          role,
          action: "delete",
        });

        // BASE users can only delete DRAFT bookings
        if (
          role === OrganizationRoles.BASE &&
          b.status !== BookingStatus.DRAFT
        ) {
          throw new ShelfError({
            cause: null,
            message:
              "You are not authorized to delete this booking. BASE users can only delete draft bookings.",
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

    // Form data is already extracted above and will be reused
    const basicBookingInfo = await findUniqueOrThrow(db, "Booking", {
      where: { id },
      select: "id, status, from, to",
    });
    const workingHours = await getWorkingHoursForOrganization(organizationId);
    const bookingSettings =
      await getBookingSettingsForOrganization(organizationId);
    switch (intent) {
      case "save": {
        const hints = getHints(request);
        const parsedData = parseData(
          formData,
          BookingFormSchema({
            action: "save",
            status: basicBookingInfo.status,
            hints,
            workingHours,
            bookingSettings,
            isAdminOrOwner,
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

        const tags = buildTagsSet(parsedData.tags).set;

        const booking = await updateBasicBooking({
          id,
          organizationId,
          name: parsedData.name,
          description: parsedData.description,
          from: formattedFrom,
          to: formattedTo,
          custodianUserId: parsedData.custodian?.userId,
          custodianTeamMemberId: parsedData.custodian?.id,
          tags,
          userId,
          hints: getClientHint(request),
        });

        sendNotification({
          title: "Booking saved",
          message: "Your booking has been saved successfully",
          icon: { name: "success", variant: "success" },
          senderId: userId,
        });

        return data(payload({ booking }), {
          headers,
        });
      }
      case "reserve": {
        const hints = getHints(request);

        const parsedData = parseData(
          formData,
          BookingFormSchema({
            hints,
            action: "reserve",
            status: basicBookingInfo.status,
            workingHours,
            bookingSettings,
            isAdminOrOwner,
          }),
          {
            additionalData: { userId, id, organizationId, role },
          }
        );

        const from = formData.get("startDate");
        const to = formData.get("endDate");
        const tags = buildTagsSet(parsedData.tags).set;

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
          name: parsedData.name,
          description: parsedData.description,
          from: formattedFrom,
          to: formattedTo,
          custodianUserId: parsedData.custodian?.userId,
          custodianTeamMemberId: parsedData.custodian?.id,
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

        return data(payload({ booking }), {
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
          content: `${actor} checked out asset with ${bookingLink}.`,
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

        return data(payload({ booking }), {
          headers,
        });
      }
      case "checkIn": {
        // Enforce explicit check-in requirement based on role and settings
        if (
          role === OrganizationRoles.ADMIN &&
          bookingSettings.requireExplicitCheckinForAdmin
        ) {
          throw new ShelfError({
            cause: null,
            title: "Not allowed to quick check-in",
            message:
              "Explicit check-in is required in this organization. Please use the explicit check-in scanner.",
            status: 403,
            label: "Booking",
          });
        }
        if (
          role === OrganizationRoles.SELF_SERVICE &&
          bookingSettings.requireExplicitCheckinForSelfService
        ) {
          throw new ShelfError({
            cause: null,
            title: "Not allowed to quick check-in",
            message:
              "Explicit check-in is required in this organization. Please use the explicit check-in scanner.",
            status: 403,
            label: "Booking",
          });
        }

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
          content: `${actor} checked in asset with ${bookingLink}.`,
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

        return data(payload({ booking, success: true }), {
          headers,
        });
      }
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
        const asset = await findUnique(db, "Asset", {
          where: { id: assetId, organizationId },
          select: "id, title",
        });

        const b = await removeAssets({
          booking: { id, assetIds: [assetId as string] },
          firstName: user?.firstName || "",
          lastName: user?.lastName || "",
          userId,
          organizationId,
          assets: asset ? [asset] : [],
        });

        void sendBookingUpdatedEmail({
          bookingId: id,
          organizationId,
          userId,
          changes: [
            "An asset was removed from the booking. View booking activity for full details",
          ],
          hints: getClientHint(request),
        });

        sendNotification({
          title: "Asset removed",
          message: "Your asset has been removed from the booking",
          icon: { name: "success", variant: "success" },
          senderId: userId,
        });

        return data(payload({ booking: b }), {
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

        return data(payload({ success: true }), { headers });
      }
      case "cancel": {
        const { cancellationReason } = parseData(
          formData,
          CancelBookingSchema,
          {
            additionalData: { userId, id, organizationId, role },
          }
        );
        const cancelledBooking = await cancelBooking({
          id,
          organizationId,
          hints: getClientHint(request),
          userId: user.id,
          cancellationReason,
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
          content: `${actor} cancelled booking ${cancelledBookingLink}.${
            cancellationReason ? `\n\nReason: ${cancellationReason}` : ""
          }`,
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

        return data(payload({ success: true }), {
          headers,
        });
      }
      case "removeKit": {
        const { kitId } = parseData(formData, z.object({ kitId: z.string() }), {
          additionalData: { userId, id, organizationId, role },
        });

        const kitRows = await queryRaw<{
          id: string;
          name: string;
          assetId: string | null;
        }>(
          db,
          sql`SELECT k."id", k."name", a."id" as "assetId"
          FROM "Kit" k
          LEFT JOIN "Asset" a ON a."kitId" = k."id"
          WHERE k."id" = ${kitId} AND k."organizationId" = ${organizationId}`
        );
        if (kitRows.length === 0) {
          throw { code: "PGRST116", message: "No rows found in Kit" };
        }
        const kit = {
          id: kitRows[0].id,
          name: kitRows[0].name,
          assets: kitRows
            .filter((r) => r.assetId !== null)
            .map((r) => ({ id: r.assetId! })),
        };

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

        void sendBookingUpdatedEmail({
          bookingId: id,
          organizationId,
          userId,
          changes: [
            "A kit was removed from the booking. View booking activity for full details",
          ],
          hints: getClientHint(request),
        });

        sendNotification({
          title: "Kit removed",
          message: "Your kit has been removed from the booking",
          icon: { name: "success", variant: "success" },
          senderId: userId,
        });

        return data(payload({ booking: b }), {
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

        return payload({ success: true });
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
            isAdminOrOwner,
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
          role,
        });

        sendNotification({
          title: "Booking extended",
          message: "Your booking has been extended to new end date.",
          icon: { name: "success", variant: "success" },
          senderId: userId,
        });

        return payload({ success: true });
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
        const assets = await findMany(db, "Asset", {
          where: { id: { in: assetOrKitIds } },
          select: "id, title",
        });

        const kits = await (async () => {
          const kitRows = await queryRaw<{
            id: string;
            name: string;
            assetId: string | null;
          }>(
            db,
            sql`SELECT k."id", k."name", a."id" as "assetId"
            FROM "Kit" k
            LEFT JOIN "Asset" a ON a."kitId" = k."id"
            WHERE k."id" = ANY(${assetOrKitIds}::text[])`
          );
          // Group rows by kit
          const kitMap = new Map<
            string,
            { id: string; name: string; assets: { id: string }[] }
          >();
          for (const row of kitRows) {
            if (!kitMap.has(row.id)) {
              kitMap.set(row.id, { id: row.id, name: row.name, assets: [] });
            }
            if (row.assetId) {
              kitMap.get(row.id)!.assets.push({ id: row.assetId });
            }
          }
          return Array.from(kitMap.values());
        })();

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

        void sendBookingUpdatedEmail({
          bookingId: id,
          organizationId,
          userId,
          changes: [
            "Assets and/or kits were removed from the booking. View booking activity for full details",
          ],
          hints: getClientHint(request),
        });

        sendNotification({
          title: "Kit removed",
          message: "Your kit has been removed from the booking",
          icon: { name: "success", variant: "success" },
          senderId: userId,
        });

        return data(payload({ booking: b, success: true }), { headers });
      }
      default: {
        checkExhaustiveSwitch(intent);
        return payload(null);
      }
    }
  } catch (cause) {
    const reason = makeShelfError(
      cause,
      { userId, id },
      !isZodValidationError(cause)
    );
    return data(error(reason), { status: reason.status });
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
