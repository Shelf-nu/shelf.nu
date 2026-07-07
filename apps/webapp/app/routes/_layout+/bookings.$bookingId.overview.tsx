import {
  AssetStatus,
  BookingStatus,
  TagUseFor,
  OrganizationRoles,
  type Prisma,
} from "@prisma/client";
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
import { hasGetAllValue } from "~/hooks/use-model-filters";
import { LOCATION_WITH_HIERARCHY } from "~/modules/asset/fields";
import { getPrimaryLocation } from "~/modules/asset/utils";
import {
  primeBookingOverviewCache,
  readBookingOverviewCache,
} from "~/modules/booking/booking-overview-client-cache";
import { checkoutSessionsToLogsByAsset } from "~/modules/booking/checkout-attribution";
import { sendBookingUpdatedEmail } from "~/modules/booking/email-helpers";
import {
  archiveBooking,
  attributeDispositionsByBookingAsset,
  cancelBooking,
  checkinAssets,
  attributeCategorizedDispositionsByBookingAsset,
  checkinBooking,
  checkoutAssets,
  checkoutBooking,
  checkoutRemainingAssets,
  deleteBooking,
  extendBooking,
  getBooking,
  getBookingFlags,
  getDetailedPartialCheckinData,
  getDetailedPartialCheckoutData,
  removeAssets,
  reserveBooking,
  revertBookingToDraft,
  updateBasicBooking,
  updateBookingNotificationRecipients,
} from "~/modules/booking/service.server";
import { shapeBookingAssets } from "~/modules/booking/shape-booking-assets";
import {
  calculateBookingLifecycleProgress,
  calculatePartialCheckinProgress,
  calculateUnitCheckinProgress,
} from "~/modules/booking/utils.server";
import { getBookingSettingsForOrganization } from "~/modules/booking-settings/service.server";
import { createNotes } from "~/modules/note/service.server";
import { setSelectedOrganizationIdCookie } from "~/modules/organization/context.server";
import { TAG_WITH_COLOR_SELECT } from "~/modules/tag/constants";
import { buildTagsSet } from "~/modules/tag/service.server";
import {
  getTeamMemberForCustodianFilter,
  getTeamMemberForForm,
  getTeamMembersForNotify,
} from "~/modules/team-member/service.server";
import type { RouteHandleWithName } from "~/modules/types";
import { getUserByID } from "~/modules/user/service.server";
import { getWorkingHoursForOrganization } from "~/modules/working-hours/service.server";
import bookingPageCss from "~/styles/booking.css?url";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";
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
import type { Route } from "./+types/bookings.$bookingId.overview";

export type BookingPageLoaderData = typeof loader;

export async function loader({ context, request, params }: LoaderFunctionArgs) {
  const authSession = context.getSession();
  const { userId } = authSession;
  const { bookingId } = getParams(params, z.object({ bookingId: z.string() }), {
    additionalData: { userId },
  });

  const searchParams = getCurrentSearchParams(request);
  const paramsValues = getParamsValues(searchParams);
  const { page, perPageParam, orderDirection, search } = paramsValues;
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
    const [booking, tags, notifyData] = await Promise.all([
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
              displayName: true,
              profilePicture: true,
            },
          },
          // Only include notification recipients for admin/owner users.
          // Self-service/base users don't need this data (they can't see or
          // manage notification settings).
          ...(isSelfServiceOrBase
            ? {}
            : {
                notificationRecipients: {
                  select: {
                    id: true,
                    name: true,
                    user: {
                      select: {
                        id: true,
                        email: true,
                        firstName: true,
                        lastName: true,
                      },
                    },
                  },
                },
              }),
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
      // Only fetch notification team members for admin/owner users
      isSelfServiceOrBase
        ? Promise.resolve({
            teamMembersForNotify: [],
            totalTeamMembersForNotify: 0,
          })
        : getTeamMembersForNotify({ organizationId }),
    ]);

    // Exclude custodian from the notification recipients picker since
    // the custodian is always notified and doesn't need to be added
    if (booking.custodianTeamMemberId) {
      notifyData.teamMembersForNotify = notifyData.teamMembersForNotify.filter(
        (tm) => tm.id !== booking.custodianTeamMemberId
      );
      notifyData.totalTeamMembersForNotify =
        notifyData.teamMembersForNotify.length;
    }

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
    /**
     * Flatten bookingAssets pivot to a plain assets array for downstream
     * use. Preserves `bookedQuantity` from the pivot so quantity-tracked
     * assets display how many units were booked.
     *
     * Kit attribution reads `BookingAsset.assetKitId` (per-row
     * discriminator) rather than `asset.assetKits[0]?.kitId` (asset's
     * incidental kit memberships). A qty-tracked asset can have both
     * a standalone slice (`assetKitId IS NULL`) and a kit-driven
     * slice in the same booking; each appears as its own row.
     *
     * The row's `kitId`/`kit` keep their old field names so the
     * downstream grouping helper (`groupAndSortAssetsByKit`) and the
     * pagination logic below need no changes — but their *meaning*
     * shifts: now it's "the kit this row was booked under", not "any
     * kit this asset happens to belong to".
     *
     * A `bookingAssetId` field is added so the UI can render two rows
     * for the same asset (standalone + kit-driven) without key
     * collisions in React.
     */
    const bookingAssets = booking.bookingAssets.map((ba) => {
      // Match the BookingAsset's `assetKitId` against the asset's set of
      // AssetKit memberships to resolve which specific kit this row
      // was booked under. Multi-kit qty-tracked assets can have several
      // memberships; only the one whose `id` matches contributes here.
      const sourceKit = ba.assetKitId
        ? ba.asset.assetKits.find((ak) => ak.id === ba.assetKitId) ?? null
        : null;
      return {
        ...ba.asset,
        bookingAssetId: ba.id,
        bookedQuantity: ba.quantity,
        // Null when standalone — UI groups these as individual items
        // outside of any kit. Non-null surfaces the kit's name in the
        // detail list and groups other slices of the same kit together.
        kitId: sourceKit?.kitId ?? null,
        kit: sourceKit?.kit ?? null,
      };
    });

    const hasAvailableAssets = bookingAssets.some(
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

    // Progressive checkout: a booking can have items scanned out one-by-one.
    // Fetch the partial-checkout records whenever the booking could have them.
    // This MUST include COMPLETE/ARCHIVED: once a booking is finished all assets
    // are back to AVAILABLE, so a status check alone (`hasCheckedOutAssets`)
    // would miss them — and then never-checked-out assets would wrongly render
    // the "Returned" badge again (hasProgressiveCheckout would be false because
    // checkedOutAssetIds came back empty). DRAFT/CANCELLED never have records.
    // `booking.assets` no longer exists post-pivot — derive the CHECKED_OUT
    // probe from `booking.bookingAssets` (whose `asset.status` is selected via
    // BOOKING_WITH_ASSETS_INCLUDE).
    const hasCheckedOutAssets = booking.bookingAssets.some(
      (ba) => ba.asset.status === "CHECKED_OUT"
    );
    const canHavePartialCheckouts = [
      "RESERVED",
      "ONGOING",
      "OVERDUE",
      "COMPLETE",
      "ARCHIVED",
    ].includes(booking.status);
    const { checkedOutAssetIds, partialCheckoutDetails } =
      hasCheckedOutAssets || canHavePartialCheckouts
        ? await getDetailedPartialCheckoutData({
            bookingId: booking.id,
            organizationId,
          })
        : { checkedOutAssetIds: [] as string[], partialCheckoutDetails: {} };

    // `booking` already has full asset+kit light data via the BookingAsset pivot.
    // Derive all asset IDs and all (current-booking) kit IDs from the
    // BookingAsset pivot. A single asset can have multiple BookingAsset
    // slices (one standalone + N kit-driven, Polish-6 multi-row) so we
    // dedupe by assetId before enrichment. Kit ids come from each slice's
    // `assetKitId` resolved through `asset.assetKits` so the slice's kit
    // identity stays correct for qty-tracked assets in multiple kits.
    const allBookingAssetIds = [
      ...new Set(booking.bookingAssets.map((ba) => ba.assetId)),
    ];
    const allBookingKitIds = [
      ...new Set(
        booking.bookingAssets
          .map((ba) => {
            if (!ba.assetKitId) return null;
            return (
              ba.asset.assetKits.find((ak) => ak.id === ba.assetKitId)?.kitId ??
              null
            );
          })
          .filter((id): id is string => id !== null)
      ),
    ];

    /**
     * Hoisted set of QT asset IDs in this booking. Originally computed
     * further down for the disposition pipeline; hoisted so the
     * "insufficient stock" workspace-availability queries below can reuse
     * the same list without re-walking `booking.bookingAssets` twice.
     */
    const qtyAssetIdsInBooking = booking.bookingAssets
      .filter((ba) => ba.asset?.type === "QUANTITY_TRACKED")
      .map((ba) => ba.assetId);

    // Execute all necessary queries in parallel. Asset + kit enrichment now
    // covers ALL booking assets/kits (not just the current page) so the
    // clientLoader can re-shape from cache without a server round-trip.
    const [
      teamMembersData,
      teamMembersForFormData,
      rawAssets,
      bookingFlags,
      rawKits,
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
       * Enrich ALL booking assets (full booking, not just the current page) so
       * the clientLoader can re-shape from cache.
       * SECURITY (cross-org IDOR): scope to the caller's organizationId.
       */
      db.asset.findMany({
        where: {
          id: { in: allBookingAssetIds },
          organizationId,
        },
        include: {
          category: true,
          // Explicit select (was `custody: true`) so `kitCustodyId` is
          // available downstream. The QT workspace-availability
          // calculation must exclude kit-level custody rows from the
          // "in custody" subtraction — only operator (asset-level) custody
          // counts against global headroom; kit custody is internal
          // earmarking and shouldn't reduce the available pool.
          custody: { select: { id: true, quantity: true, kitCustodyId: true } },
          tags: TAG_WITH_COLOR_SELECT,
          // Pivot-aware kit relation — kits live on the `AssetKit` pivot
          // post-4a, so include each membership with its full kit + the
          // kit's pickup location (rendered on the booking page kit row).
          assetKits: {
            include: {
              kit: { include: { location: LOCATION_WITH_HIERARCHY } },
            },
          },
          // Asset's pickup location lives on the `AssetLocation` pivot
          // post-4b. Rendered in the booking Location column via
          // `getPrimaryLocation` at the loader boundary.
          assetLocations: {
            include: { location: LOCATION_WITH_HIERARCHY },
          },
          // Code-resolution relations — required for AssetCodeBadge on the
          // booking detail page rows. Scalar fields (sequentialId,
          // preferredBarcodeId) come in automatically via `include`; the
          // relations must be listed explicitly. Tight selects per
          // `~/modules/barcode/display.ts`.
          qrCodes: { take: 1, select: { id: true } },
          barcodes: { select: { id: true, type: true, value: true } },
          bookingAssets: {
            where: {
              booking: {
                ...(booking.from && booking.to
                  ? {
                      OR: [
                        // Rule 1: RESERVED bookings always conflict
                        {
                          status: "RESERVED",
                          id: { not: booking.id },
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
                        // Rule 2: ONGOING/OVERDUE bookings
                        {
                          status: { in: ["ONGOING", "OVERDUE"] },
                          id: { not: booking.id },
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
            include: {
              booking: true,
            },
          },
        },
      }),

      /** Calculate booking flags considering all assets */
      getBookingFlags({
        id: booking.id,
        assetIds: bookingAssets.map((a) => a.id),
        // An "empty" booking with only model-level reservations must
        // still be reservable. Passing the count lets the flags helper
        // surface `hasModelRequests` for the Reserve disable check.
        modelRequestCount: booking.modelRequests?.length ?? 0,
        from: booking.from,
        to: booking.to,
        organizationId,
      }),

      /**
       * Enrich ALL booking kits (full booking, not just the current page) so
       * the clientLoader can re-shape from cache.
       */
      db.kit.findMany({
        where: {
          id: { in: allBookingKitIds },
          organizationId,
        },
        include: {
          category: {
            select: {
              id: true,
              name: true,
              color: true,
            },
          },
          // Code-resolution relations — required for AssetCodeBadge on
          // the kit row inside this booking. See `~/modules/barcode/display.ts`
          // and `.claude/rules/code-bearing-entity-list-consistency.md`.
          qrCodes: { take: 1, select: { id: true } },
          barcodes: { select: { id: true, type: true, value: true } },
          // Kit's pickup location — rendered on the kit row (kits keep a
          // direct `locationId` FK; the pivot is asset-side only).
          location: LOCATION_WITH_HIERARCHY,
          // Member count via the `AssetKit` pivot post-4a.
          _count: { select: { assetKits: true } },
        },
      }),
    ]);

    // Index the enriched assets for lookup during per-slice projection below
    // (`shapeBookingAssets` consumes `rawKits` directly, so we don't index it
    // here — main's helper builds its own kits map internally).
    const assetDetailsMap = new Map(rawAssets.map((a) => [a.id, a]));

    /**
     * Build the view-asset array `shapeBookingAssets` consumes: one entry
     * PER BookingAsset slice. A qty-tracked asset can have one standalone
     * (`assetKitId IS NULL`) + N kit-driven slices in the same booking
     * (Polish-6 multi-row); each must render in its own kit group so the
     * page mirrors the booking's structure exactly.
     *
     * Each entry carries the singular `kitId` / `kit` / `location` /
     * `category` shape the in-memory filter / sort / group helpers expect
     * (pre-pivot main authored those against `Asset.kitId` / `Asset.location`).
     * `bookingAssetId` + `bookedQuantity` come straight off the pivot row
     * so downstream qty enrichment can attribute dispositions per-row.
     */
    const enrichedAssetsForView = booking.bookingAssets.map((ba) => {
      const detail = assetDetailsMap.get(ba.assetId);
      const base = detail ?? ba.asset;
      const matchedAssetKit = ba.assetKitId
        ? (detail ?? ba.asset).assetKits.find(
            (ak) => ak.id === ba.assetKitId
          ) ?? null
        : null;
      return {
        ...base,
        kitId: matchedAssetKit?.kitId ?? null,
        kit: matchedAssetKit?.kit ?? null,
        location: getPrimaryLocation(base) ?? null,
        bookingAssetId: ba.id,
        bookedQuantity: ba.quantity ?? 1,
      };
    });

    // NOTE: the filter → sort → group-by-kit → paginate step
    // (`shapeBookingAssets`) is deferred to AFTER the per-slice checkout /
    // disposition maps are computed below, so the status sort can decide
    // "checked out" per-slice (a fully-checked-out kit slice must sink even
    // when the multi-slice QT asset's GLOBAL status hasn't flipped). See the
    // `enrichedAssetsForSort` construction further down.

    /**
     * Sum already-dispositioned units per qty-tracked asset for this
     * booking (RETURN + CONSUME + LOSS + DAMAGE ConsumptionLog rows).
     * Attached per-row to each enriched view item below so the row UI can:
     *   - show "Partially checked in" when `dispositioned > 0 && remaining > 0`
     *   - render `remaining / booked` in the Qty column for partials
     *   - show the fully-reconciled state once `dispositioned == booked`
     *
     * Only queries qty-tracked asset ids (empty query short-circuits).
     *
     * Note: `qtyAssetIdsInBooking` is hoisted above the parallel block so
     * the workspace-availability groupBys can reuse the same list.
     */

    /**
     * Per-row attribution. With Polish-6 multi-row slices, an asset
     * can have a kit-driven row AND a standalone row in the same
     * booking; ConsumptionLog now carries `bookingAssetId` so each
     * disposition can be attributed exactly. Legacy logs
     * (`bookingAssetId IS NULL`) get greedy-attributed by
     * `attributeCategorizedDispositionsByBookingAsset` — standalone rows
     * fill first, then kit-driven (consistent with the check-out fallback).
     */
    const dispositionLogs =
      qtyAssetIdsInBooking.length > 0
        ? await db.consumptionLog.findMany({
            where: {
              bookingId: booking.id,
              assetId: { in: qtyAssetIdsInBooking },
              category: { in: ["RETURN", "CONSUME", "LOSS", "DAMAGE"] },
            },
            select: {
              assetId: true,
              category: true,
              quantity: true,
              bookingAssetId: true,
            },
          })
        : [];

    type DispositionBreakdown = {
      returned: number;
      consumed: number;
      lost: number;
      damaged: number;
    };
    const emptyBreakdown = (): DispositionBreakdown => ({
      returned: 0,
      consumed: 0,
      lost: 0,
      damaged: 0,
    });

    /**
     * Map<assetId, BookingAsset[]> for the greedy attribution fallback.
     * Built once and shared across all four category attributions so the
     * standalone-fills-first ordering stays consistent.
     */
    const bookingAssetRowsByAsset = new Map<
      string,
      Array<{
        id: string;
        quantity: number;
        assetKitId: string | null;
      }>
    >();
    for (const ba of booking.bookingAssets) {
      if (ba.asset?.type !== "QUANTITY_TRACKED") continue;
      const arr = bookingAssetRowsByAsset.get(ba.assetId) ?? [];
      arr.push({
        id: ba.id,
        quantity: ba.quantity,
        assetKitId: ba.assetKitId ?? null,
      });
      bookingAssetRowsByAsset.set(ba.assetId, arr);
    }

    /** Logs grouped by assetId (each carries its own category). */
    const logsByAsset = new Map<
      string,
      Array<{
        bookingAssetId: string | null;
        category: "RETURN" | "CONSUME" | "LOSS" | "DAMAGE";
        quantity: number;
      }>
    >();
    for (const log of dispositionLogs) {
      const arr = logsByAsset.get(log.assetId) ?? [];
      arr.push({
        bookingAssetId: log.bookingAssetId ?? null,
        category: log.category as "RETURN" | "CONSUME" | "LOSS" | "DAMAGE",
        quantity: log.quantity,
      });
      logsByAsset.set(log.assetId, arr);
    }

    const breakdownByBookingAsset = new Map<string, DispositionBreakdown>();
    const dispositionedByBookingAsset = new Map<string, number>();
    for (const [assetId, rows] of bookingAssetRowsByAsset) {
      for (const row of rows) {
        breakdownByBookingAsset.set(row.id, emptyBreakdown());
        dispositionedByBookingAsset.set(row.id, 0);
      }
      // Shared-capacity attribution across all categories — prevents a
      // kit-driven row from being independently refilled by each category
      // (which over-counted before, surfacing wrong totals + breakdowns).
      const attributed = attributeCategorizedDispositionsByBookingAsset({
        bookingAssetRows: rows,
        consumptionLogs: logsByAsset.get(assetId) ?? [],
      });
      for (const [bookingAssetId, b] of attributed) {
        breakdownByBookingAsset.set(bookingAssetId, b);
        dispositionedByBookingAsset.set(
          bookingAssetId,
          b.returned + b.consumed + b.lost + b.damaged
        );
      }
    }

    /**
     * Per-row progressive-checkout attribution (OUT-side mirror of the
     * disposition attribution above). For each qty-tracked asset, sum the
     * units that have been progressively checked out via
     * `PartialBookingCheckout` rows, then attribute that scalar across the
     * asset's BookingAsset slices using the same standalone-fills-first
     * greedy attributor used on the check-IN side.
     *
     * `PartialBookingCheckout` has no per-row FK (no `bookingAssetId`
     * column) — every checkout entry is therefore treated as legacy
     * (`bookingAssetId: null`) by `attributeDispositionsByBookingAsset`,
     * which routes the whole pool through the greedy fill. That's exactly
     * the symmetry we want with the legacy-disposition pool on the
     * check-IN side.
     *
     * Legacy fallback: pre-Wave-B `PartialBookingCheckout` rows have
     * `quantities[].length !== assetIds[].length` (often empty) — in that
     * case count one unit per occurrence per asset, mirroring the read
     * convention in `service.server.ts` (`countCheckedOutUnitsForAsset`,
     * around line 2862-2870).
     *
     * Drives the new `PARTIALLY_CHECKED_OUT_QTY_PENDING_RETURN` badge:
     * rows with `checkedOutQuantity > 0 && dispositionedQuantity === 0`
     * are progressively-checked-out-but-not-yet-returned. Rows whose
     * disposition has started still flow through the existing
     * `PARTIALLY_CHECKED_OUT_QTY` (violet, "returns underway") badge.
     */
    const checkoutSessions =
      qtyAssetIdsInBooking.length > 0
        ? await db.partialBookingCheckout.findMany({
            where: { bookingId: booking.id },
            select: {
              assetIds: true,
              quantities: true,
              bookingAssetIds: true,
            },
          })
        : [];

    // Map<assetId, Array<{ bookingAssetId: string | null, quantity }>> — parsed
    // via the shared `checkoutSessionsToLogsByAsset` so every read site honors
    // the positional `bookingAssetIds` contract identically. Entries tagged with
    // a persisted `bookingAssetId` attribute to their exact slice; `""`/legacy
    // rows collapse to `null` → the attributor greedy-fills them. An asset is
    // qty-tracked here iff it has BookingAsset rows in `bookingAssetRowsByAsset`.
    const checkoutLogsByAsset = checkoutSessionsToLogsByAsset(
      checkoutSessions,
      (assetId) => bookingAssetRowsByAsset.has(assetId)
    );

    // Initialize every qty-tracked row to 0 so downstream lookups never
    // see `undefined` for a row that simply hasn't been checked out yet.
    const checkedOutByBookingAsset = new Map<string, number>();
    for (const [, rows] of bookingAssetRowsByAsset) {
      for (const row of rows) checkedOutByBookingAsset.set(row.id, 0);
    }
    for (const [assetId, rows] of bookingAssetRowsByAsset) {
      const attributed = attributeDispositionsByBookingAsset({
        bookingAssetRows: rows,
        consumptionLogs: checkoutLogsByAsset.get(assetId) ?? [],
      });
      for (const [bookingAssetId, qty] of attributed) {
        checkedOutByBookingAsset.set(bookingAssetId, qty);
      }
    }

    /**
     * Attach the per-slice checkout / disposition data onto each view row
     * BEFORE sorting, so the status sort can decide "checked out" per-slice.
     * A QUANTITY_TRACKED asset that spans a kit slice + a standalone slice
     * never flips its GLOBAL `Asset.status` until every slice is out, so a
     * fully-checked-out kit slice can only be recognised from these per-row
     * counters. Carried on `rawAssets` in the loader payload too, so the
     * clientLoader re-sort keeps them on cache-hit reshapes (which return
     * `view.items` straight from `rawAssets`, bypassing `enrichedItems`).
     * `dispositionBreakdown` is included alongside the counters so the QT
     * return tooltip survives client-side search/sort/pagination. Keyed by
     * `bookingAssetId`.
     */
    const enrichedAssetsForSort = enrichedAssetsForView.map((asset) => {
      const bookingAssetId = (asset as { bookingAssetId?: string })
        .bookingAssetId;
      return {
        ...asset,
        checkedOutQuantity: bookingAssetId
          ? checkedOutByBookingAsset.get(bookingAssetId) ?? 0
          : 0,
        dispositionedQuantity: bookingAssetId
          ? dispositionedByBookingAsset.get(bookingAssetId) ?? 0
          : 0,
        dispositionBreakdown:
          (bookingAssetId && breakdownByBookingAsset.get(bookingAssetId)) ||
          emptyBreakdown(),
      };
    });

    // Delegate filter → sort → group-by-kit → paginate to the shared pure
    // shapeBookingAssets helper. The same function runs in clientLoader for
    // subsequent navigations (no server round-trip).
    const view = shapeBookingAssets({
      rawAssets: enrichedAssetsForSort,
      rawKits,
      search,
      orderBy,
      orderDirection,
      page,
      perPage,
      partialCheckinDetails,
      bookingStatus: booking.status,
    });

    /**
     * Per-asset remaining-to-checkout: folds the per-slice checked-out
     * counters back into one total per qty-tracked asset on the booking.
     * An asset is "fully out" only when this number reaches 0; while it's
     * still positive there are units left to scan, even if at least one
     * slice of the asset has already been (partially) checked out.
     *
     * Drives the bulk check-out dialog filter + scanner drawer eligibility
     * so the client correctly distinguishes "partially out, more to go"
     * from "fully out" for QT assets that span multiple slices (kit +
     * standalone, or several kit slices).
     */
    // Legacy / all-at-once checkout fallback. A quick checkout flips the asset
    // status to CHECKED_OUT but writes NO `PartialBookingCheckout` rows, so the
    // progressive `checkedOutByBookingAsset` counters are all 0 even though every
    // booked unit is physically out. An ONGOING/OVERDUE booking with ZERO
    // checkout sessions can ONLY have reached that state via the all-at-once flow
    // (the progressive flow always writes a session row per batch), so treat every
    // booked unit as out → remaining 0. Without this the inline math reports
    // `booked − 0 = booked` and wrongly offers a fully-out QT asset for more
    // checkout in the bulk-checkout dialog + scanner drawer.
    //
    // KEEP IN SYNC with the canonical `computeBookingAssetRemainingToCheckOut`
    // (modules/booking/service.server.ts), which the checkout-assets route uses;
    // this loader mirrors that logic in-memory to avoid an extra query per asset.
    const isLegacyAllAtOnceCheckout =
      checkoutSessions.length === 0 &&
      (booking.status === BookingStatus.ONGOING ||
        booking.status === BookingStatus.OVERDUE);

    const remainingToCheckOutByAsset: Record<string, number> = {};
    for (const [assetId, rows] of bookingAssetRowsByAsset) {
      const totalBooked = rows.reduce((sum, row) => sum + row.quantity, 0);
      if (isLegacyAllAtOnceCheckout && totalBooked > 0) {
        remainingToCheckOutByAsset[assetId] = 0;
        continue;
      }
      let totalCheckedOut = 0;
      for (const row of rows) {
        totalCheckedOut += checkedOutByBookingAsset.get(row.id) ?? 0;
      }
      remainingToCheckOutByAsset[assetId] = Math.max(
        0,
        totalBooked - totalCheckedOut
      );
    }

    /**
     * Workspace-level "available units" per QT asset on this booking.
     *
     * For each qty-tracked asset on this booking, computes the units that
     * are NOT currently committed elsewhere in the workspace:
     *
     *   available = total
     *             − (operator custody)
     *             − (reserved in OTHER bookings, status = RESERVED)
     *             − (checked out in OTHER bookings, status in ONGOING/OVERDUE)
     *
     * Used by the new "Insufficient stock" badge on the booking-overview
     * asset row + assets sidebar: fires when `bookedQuantity` on a row
     * exceeds `availableUnitsByAsset[assetId]`.
     *
     * Subtraction notes:
     *  - Only ASSET-level custody (`kitCustodyId == null`) counts. Kit
     *    custody rows are internal earmarking and must not reduce global
     *    headroom (avoids double-counting kit-driven slices, mirrors the
     *    availableHelper audit gotcha).
     *  - This booking is EXCLUDED via `id: { not: bookingId }` — the
     *    badge is about pressure from OTHER bookings on the shared pool;
     *    the current booking's own reservation is what we're comparing
     *    against.
     *  - `assetKits` allocations are NOT subtracted. Pre-kit-checkout,
     *    units inside a kit are still in the asset's available pool.
     *
     * The groupBys are scoped to this workspace's bookings via the
     * relation filter (`booking: { organizationId, ... }`) to prevent
     * cross-org leakage.
     */
    const [globalReservedRows, globalCheckedOutRows] =
      qtyAssetIdsInBooking.length > 0
        ? await Promise.all([
            db.bookingAsset.groupBy({
              by: ["assetId"],
              where: {
                assetId: { in: qtyAssetIdsInBooking },
                booking: {
                  organizationId,
                  status: "RESERVED",
                  id: { not: bookingId },
                },
              },
              _sum: { quantity: true },
            }),
            db.bookingAsset.groupBy({
              by: ["assetId"],
              where: {
                assetId: { in: qtyAssetIdsInBooking },
                booking: {
                  organizationId,
                  status: { in: ["ONGOING", "OVERDUE"] },
                  id: { not: bookingId },
                },
              },
              _sum: { quantity: true },
            }),
          ])
        : [[], []];

    /**
     * Map of `assetId → available units in the workspace pool`. Built
     * after both rawAssets and the two groupBys land. Keys are restricted
     * to QT assets that appear on this booking; INDIVIDUAL assets are
     * omitted (they have their own AvailabilityBadge paths and never get
     * the InsufficientStockBadge).
     */
    const availableUnitsByAsset: Record<string, number> = {};
    for (const asset of rawAssets) {
      if (asset.type !== "QUANTITY_TRACKED") continue;
      const total = asset.quantity ?? 0;
      // Operator (asset-level) custody only — kit-level custody is
      // internal earmarking and must not reduce global headroom.
      const inCustody = (asset.custody ?? [])
        .filter((c) => c.kitCustodyId == null)
        .reduce((sum, c) => sum + (c.quantity ?? 0), 0);
      const reserved =
        globalReservedRows.find((r) => r.assetId === asset.id)?._sum
          ?.quantity ?? 0;
      const checkedOut =
        globalCheckedOutRows.find((r) => r.assetId === asset.id)?._sum
          ?.quantity ?? 0;
      availableUnitsByAsset[asset.id] = Math.max(
        0,
        total - inCustody - reserved - checkedOut
      );
    }

    // Attach per-row qty disposition data onto the shaped view items so
    // the UI gets the Polish-6 / Phase 4 enrichment alongside main's
    // clientLoader-cache architecture.
    const enrichedItems = view.items.map((item) => ({
      ...item,
      assets: item.assets.map((asset) => {
        const bookingAssetId = (asset as { bookingAssetId?: string })
          .bookingAssetId;
        return {
          ...asset,
          dispositionedQuantity: bookingAssetId
            ? dispositionedByBookingAsset.get(bookingAssetId) ?? 0
            : 0,
          dispositionBreakdown:
            (bookingAssetId && breakdownByBookingAsset.get(bookingAssetId)) ||
            emptyBreakdown(),
          // Per-row units already checked OUT via progressive checkout.
          // 0 for non-qty rows and for rows with no PartialBookingCheckout
          // entries yet. Drives the "partially checked out, no returns yet"
          // badge + the `{checkedOut}/{booked}` Qty-column display.
          checkedOutQuantity: bookingAssetId
            ? checkedOutByBookingAsset.get(bookingAssetId) ?? 0
            : 0,
        };
      }),
    }));

    // Category options computed from the full booking (not just the current page).
    const assetCategories = booking.bookingAssets
      .map((ba) => ba.asset.category)
      .filter((category) => category !== null && category !== undefined)
      .filter(
        (category, index, self) =>
          // Find the index of the first occurrence of this category ID
          index === self.findIndex((c) => c.id === category.id)
      );
    // Kit categories derived from all rawKits (all kits, not just current page).
    const kitCategories = rawKits
      .map((kit) => kit.category)
      .filter((category) => category !== null && category !== undefined)
      .filter(
        (category, index, self) =>
          // Find the index of the first occurrence of this category ID
          index === self.findIndex((c) => c.id === category.id)
      );

    const allCategories = [...assetCategories, ...kitCategories];

    // Calculate partial check-in progress.
    //
    // Main's PR #2615 derived this from `enhancedBooking.assets` (the
    // pre-pivot legacy shape). On feat-quantities `Booking.assets` no longer
    // exists — its replacement is the per-pivot projection in
    // `enrichedAssetsForView` (built at line ~507 from `booking.bookingAssets`
    // with `kitId` resolved through `assetKit.kit.id`). Same shape main fed
    // in (`{ id, kitId }[]`), no second DB round-trip, and the in-memory
    // basis is already org-scoped via the org-scoped `getBooking` fetch.
    const bookingAssetsForProgress = enrichedAssetsForView.map((asset) => ({
      id: asset.id,
      kitId: asset.kitId,
    }));
    const totalBookingAssets = bookingAssetsForProgress.length;

    // Read the workspace setting with a lean query. We intentionally avoid
    // getBookingSettingsForOrganization here because that performs an upsert
    // write, which is undesirable in a read-only loader path.
    const bookingSettings = await db.bookingSettings.findUnique({
      where: { organizationId },
      select: { countKitsAsSingleUnit: true },
    });
    const countKitsAsSingleUnit =
      bookingSettings?.countKitsAsSingleUnit ?? false;

    const partialCheckinProgress = countKitsAsSingleUnit
      ? calculateUnitCheckinProgress(
          bookingAssetsForProgress,
          checkedInAssetIds,
          booking.status
        )
      : calculatePartialCheckinProgress(
          totalBookingAssets,
          checkedInAssetIds,
          booking.status
        );

    // Segmented lifecycle progress (Booked / Checked out / Returned) backing
    // the progress bar on the booking detail page. Reuses the pivot projection
    // built at `enrichedAssetsForView` — each row already carries `id`,
    // `kitId` (resolved through the slice's `assetKitId`), and `status`
    // (selected by BOOKING_WITH_ASSETS_INCLUDE).
    //
    // INDIVIDUAL rows bucket by asset `status` + `checkedInAssetIds`
    // (partial-checkin records). QT rows bucket by per-row qty counters
    // (`bookedQuantity`, `checkedOutQuantity`, `dispositionedQuantity`)
    // rather than asset status, because a partially-checked-out QT row's
    // status can still be `AVAILABLE` while a portion of its booked units
    // is physically out. The qty maps populated above
    // (`checkedOutByBookingAsset`, `dispositionedByBookingAsset`) supply
    // those per-row counters via the slice's `bookingAssetId`.
    const lifecycleProgress = calculateBookingLifecycleProgress({
      bookingAssets: enrichedAssetsForView.map((a) => {
        const isQty = a.type === "QUANTITY_TRACKED";
        return {
          id: a.id,
          kitId: a.kitId,
          status: a.status,
          assetType: a.type,
          bookedQuantity: a.bookedQuantity,
          checkedOutQuantity: isQty
            ? checkedOutByBookingAsset.get(a.bookingAssetId) ?? 0
            : 0,
          dispositionedQuantity: isQty
            ? dispositionedByBookingAsset.get(a.bookingAssetId) ?? 0
            : 0,
        };
      }),
      checkedInAssetIds,
      checkedOutAssetIds,
      bookingStatus: booking.status,
      countKitsAsSingleUnit,
    });

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
        booking,
        modelName,
        // Shaped view for first paint (same field names the component reads),
        // post-enriched with per-row qty disposition data (Polish-6 multi-row).
        items: enrichedItems,
        page,
        // `totalItems` drives the `ListTitle` header count. We include
        // outstanding `BookingModelRequest` rows on top of the paginated
        // asset/kit items because the Assets & Kits list now renders a
        // model-request row per outstanding request (Phase 3d-Polish).
        // `totalPaginationItems` stays at `view.totalPaginationItems` so
        // pagination arithmetic over the concrete asset/kit list is
        // unaffected.
        totalItems:
          view.totalPaginationItems +
          (booking.modelRequests ?? []).filter(
            (req) => req.fulfilledAt === null
          ).length,
        totalPaginationItems: view.totalPaginationItems,
        perPage,
        totalPages: view.totalPages,
        ...teamMembersData,
        teamMembersForForm,
        bookingFlags,
        totalKits: view.totalKits,
        totalValue: calculateTotalValueOfAssets({
          // Each `bookingAssets` row is built from a `BookingAsset` pivot
          // and preserves `bookedQuantity` (= `ba.quantity`). The asset's
          // stock quantity (spread from `...ba.asset`) is intentionally
          // ignored here — see `calculateTotalValueOfAssets` JSDoc.
          assets: bookingAssets.map((a) => ({
            valuation: a.valuation,
            bookedQuantity: a.bookedQuantity,
          })),
          currency: currentOrganization.currency,
          locale: getClientHint(request).locale,
        }),
        /** Assets inside the booking without kits */
        assetsCount: view.assetsCount,
        totalAssets: totalBookingAssets,
        allCategories,
        tags,
        totalTags: tags.length,
        partialCheckinProgress,
        partialCheckinDetails,
        // Progressive checkout: segmented lifecycle bar + per-asset checkout
        // details (date/user) for the "Checked out on/by" columns.
        lifecycleProgress,
        checkedOutAssetIds,
        remainingToCheckOutByAsset,
        /**
         * QT workspace-availability map (assetId → units free across the
         * workspace, excluding this booking + kit-custody). Drives the
         * "Insufficient stock" badge in `list-asset-content.tsx` and
         * `booking-assets-sidebar.tsx`. Always serialised — empty `{}` when
         * the booking has no QT assets — so consumers can rely on the key.
         */
        availableUnitsByAsset,
        partialCheckoutDetails,
        // Pivot-projected, view-ready raw assets + raw kits + shaping inputs
        // so clientLoader can re-shape without a server round-trip on
        // search/sort/pagination navigations. `rawAssets` here is the per-
        // BookingAsset-slice projection (one entry per slice, with singular
        // `kitId`/`kit`/`location`) — exactly what `shapeBookingAssets`
        // expects from main's perf rewrite, adapted to our pivot model.
        // Uses the `enrichedAssetsForSort` variant (carries per-slice
        // `checkedOutQuantity`/`dispositionedQuantity`) so the clientLoader's
        // re-sort stays per-slice aware, matching the server first paint.
        rawAssets: enrichedAssetsForSort,
        rawKits,
        // Current search string so the search input pre-fills on first paint /
        // hard refresh (SearchForm reads `search` from loader data).
        search,
        // Asset search label + tooltip listing searchable fields
        searchFieldLabel: "Search assets & kits",
        searchFieldTooltip: {
          title: "Search booking items",
          text: "Search the assets and kits in this booking. Separate keywords with a comma (,) to search with OR. Supported fields:\n- Name\n- Asset ID (SAM-id, assets only)\n- Category\n- Tags (assets only)\n- Location\n- QR code value\n- Barcode value",
        },
        ...notifyData,
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

/**
 * Client loader: makes search/sort/pagination instant by re-shaping the cached
 * server response in the browser instead of revalidating the server loader.
 *
 * Runs on hydration (`hydrate = true`); during hydration `serverLoader()`
 * returns the SSR'd data with no extra fetch. On a pure view-param navigation
 * it re-shapes from cache (no network); otherwise (first load, post-mutation
 * revalidation, non-view param change) it refetches from the server and
 * re-primes the cache.
 *
 * @see {@link file://./../../modules/booking/booking-overview-client-cache.ts}
 * @see {@link file://./../../modules/booking/shape-booking-assets.ts}
 */
export async function clientLoader({
  request,
  params,
  serverLoader,
}: Route.ClientLoaderArgs) {
  const bookingId = params.bookingId as string;
  const url = new URL(request.url);

  const cached = readBookingOverviewCache(bookingId, url);
  if (cached.hit) {
    // The cached data is the full server-loader payload. We re-shape the view
    // fields in the browser so search/sort/pagination navigations are instant.
    const serverData = cached.data as Awaited<ReturnType<typeof serverLoader>>;
    const paramsValues = getParamsValues(url.searchParams);
    // Mirror the createdAt → status normalization from the server loader.
    const orderBy =
      paramsValues.orderBy === "createdAt" ? "status" : paramsValues.orderBy;
    const view = shapeBookingAssets({
      rawAssets: serverData.rawAssets,
      rawKits: serverData.rawKits,
      search: paramsValues.search,
      orderBy,
      orderDirection: paramsValues.orderDirection,
      page: paramsValues.page,
      perPage: serverData.perPage,
      partialCheckinDetails: serverData.partialCheckinDetails,
      bookingStatus: serverData.booking.status,
    });
    return {
      ...serverData,
      items: view.items,
      // Override the view params so the pager/search UI stay in sync with the
      // reshaped items (serverData holds the values from the initial load).
      // perPage is intentionally not overridden — a per_page change is a cache
      // miss (see CLIENT_VIEW_PARAM_KEYS), so serverData.perPage is current.
      page: paramsValues.page,
      search: paramsValues.search,
      totalItems: view.totalPaginationItems,
      totalPaginationItems: view.totalPaginationItems,
      totalPages: view.totalPages,
      totalKits: view.totalKits,
      assetsCount: view.assetsCount,
    };
  }

  // Cache miss: fetch from the server and prime the cache for subsequent
  // view-only navigations.
  const serverData = await serverLoader();
  primeBookingOverviewCache(bookingId, url, serverData);
  return serverData;
}
/** Run clientLoader on hydration so the cache is primed from the SSR data. */
clientLoader.hydrate = true as const;

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
          "checkOutRemaining",
          "checkIn",
          "archive",
          "cancel",
          "removeKit",
          "revert-to-draft",
          "extend-booking",
          "bulk-remove-asset-or-kit",
          "partial-checkin",
          "partial-checkout",
          "updateNotificationRecipients",
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
      checkOutRemaining: PermissionAction.checkout,
      checkIn: PermissionAction.checkin,
      archive: PermissionAction.update,
      cancel: PermissionAction.update,
      removeKit: PermissionAction.update,
      "revert-to-draft": PermissionAction.update,
      "extend-booking": PermissionAction.extend,
      "bulk-remove-asset-or-kit": PermissionAction.update,
      "partial-checkin": PermissionAction.checkin,
      "partial-checkout": PermissionAction.checkout,
      updateNotificationRecipients: PermissionAction.update,
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
        displayName: true,
      } satisfies Prisma.UserSelect,
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
        getClientHint(request),
        userId
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
        assetIds: [
          ...new Set(
            deletedBooking.bookingAssets.map(
              (ba: { asset: { id: string } }) => ba.asset.id
            )
          ),
        ],
        organizationId,
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

    // Form data is already extracted above and will be reused.
    // Booking lookup, working hours, and booking settings are independent — fetch in parallel
    const [basicBookingInfo, workingHours, bookingSettings] = await Promise.all(
      [
        db.booking.findFirstOrThrow({
          where: { id, organizationId },
          select: { id: true, status: true, from: true, to: true },
        }),
        getWorkingHoursForOrganization(organizationId),
        getBookingSettingsForOrganization(organizationId),
      ]
    );
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
          assetIds: [...new Set(booking.bookingAssets.map((ba) => ba.assetId))],
          organizationId,
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
      case "checkOutRemaining": {
        // "Check out remaining" — check out every asset still in the booking's
        // Booked bucket at once. The service resolves the eligible ids
        // server-side (no client-supplied id list) and routes through the
        // progressive partial-checkout path, which writes notes/events.
        return await checkoutRemainingAssets({
          formData,
          request,
          bookingId: id,
          organizationId,
          userId,
          authSession,
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
            shouldBeCaptured: false,
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
            shouldBeCaptured: false,
          });
        }

        // Extract specific asset IDs if provided (for enhanced completion messaging)
        const specificAssetIds = formData.getAll(
          "specificAssetIds[]"
        ) as string[];

        // Only assets that were actually checked out get a check-in note —
        // progressive checkout can leave never-checked-out assets in the booking.
        // Post-pivot, asset → booking lookup goes via the `BookingAsset` pivot.
        const checkedOutAssetIdsBeforeCheckin = (
          await db.asset.findMany({
            where: {
              bookingAssets: { some: { bookingId: id } },
              organizationId,
              status: AssetStatus.CHECKED_OUT,
            },
            select: { id: true },
          })
        ).map((a) => a.id);

        const booking = await checkinBooking({
          id,
          organizationId,
          hints: getClientHint(request),
          intentChoice: checkinIntentChoice,
          userId: user.id,
          specificAssetIds:
            specificAssetIds.length > 0 ? specificAssetIds : undefined,
        });

        // Only write notes for assets that were actually checked out before
        // this check-in. With progressive checkout, a booking may still have
        // un-checked-out assets at check-in time — those shouldn't get a
        // "checked in" note. Falls back to no-op when nothing was out.
        if (checkedOutAssetIdsBeforeCheckin.length > 0) {
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
            assetIds: checkedOutAssetIdsBeforeCheckin,
            organizationId,
          });
        }

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
      case "partial-checkout": {
        return await checkoutAssets({
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
          assetIds: [
            ...new Set(
              cancelledBooking.bookingAssets.map(
                (ba: { assetId: string }) => ba.assetId
              )
            ),
          ],
          organizationId,
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

        const kit = await db.kit.findUniqueOrThrow({
          where: { id: kitId, organizationId },
          select: {
            id: true,
            name: true,
            assetKits: { select: { asset: { select: { id: true } } } },
          },
        });

        const b = await removeAssets({
          booking: {
            id,
            assetIds: kit.assetKits.map((ak) => ak.asset.id),
          },
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

        // `endDate` is already a zoned `Date` produced by the schema's
        // `coerceLocalDate(timeZone)`, so no further parsing is needed here.
        await extendBooking({
          id,
          organizationId,
          hints,
          newEndDate: endDate,
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
      case "updateNotificationRecipients": {
        if (isSelfServiceOrBase) {
          throw new ShelfError({
            cause: null,
            message:
              "You do not have permission to manage notification recipients.",
            label: "Booking",
            shouldBeCaptured: false,
            status: 403,
          });
        }

        const recipientIdsRaw = formData.get(
          "notificationRecipientIds"
        ) as string;
        const teamMemberIds = recipientIdsRaw
          ? recipientIdsRaw.split(",").filter(Boolean)
          : [];

        await updateBookingNotificationRecipients({
          bookingId: id,
          organizationId,
          teamMemberIds,
        });

        sendNotification({
          title: "Notifications updated",
          message: "Booking notification recipients have been updated.",
          icon: { name: "success", variant: "success" },
          senderId: userId,
        });

        return data(payload({ success: true }), { headers });
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
          where: { id: { in: assetOrKitIds }, organizationId },
          select: { id: true, title: true },
        });

        const kits = await db.kit.findMany({
          where: { id: { in: assetOrKitIds }, organizationId },
          select: {
            id: true,
            name: true,
            assetKits: { select: { asset: { select: { id: true } } } },
          },
        });

        // Get asset IDs that belong to the selected kits
        const kitAssetIds = kits.flatMap((kit) =>
          kit.assetKits.map((ak) => ak.asset.id)
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
    "booking.overview.fulfil-and-checkout",
    "booking.overview.checkout-assets",
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
