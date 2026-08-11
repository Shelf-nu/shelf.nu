import type {
  Asset,
  Location,
  Category,
  Organization,
  Prisma,
  Kit,
  OrganizationRoles,
} from "@prisma/client";
import { db } from "~/database/db.server";
import { validateBookingOwnership } from "~/utils/booking-authorization.server";
import { calculateTotalValueOfAssets } from "~/utils/bookings";
import { getClientHint } from "~/utils/client-hints";
import { ShelfError } from "~/utils/error";
import type { PdfSnapshotKit } from "./helpers";
import {
  buildPdfAssetRows,
  filterBookingAssets,
  groupAndSortAssetsByKit,
} from "./helpers";
import { getBooking } from "./service.server";
import { getPrimaryLocation } from "../asset/utils";
import { getQrCodeMaps } from "../qr/service.server";
import { TAG_WITH_COLOR_SELECT } from "../tag/constants";

export interface SortParams {
  orderBy?: string;
  orderDirection?: "asc" | "desc";
  /** Active asset search from the booking page (`s` param). */
  search?: string | null;
}

/**
 * Minimal shape of a `BookingModelRequest` row as consumed by the PDF
 * preview's "Requested models" section (Phase 3d — Book-by-Model).
 * Declared structurally so callers that query a booking via
 * `BOOKING_WITH_ASSETS_INCLUDE` (which includes `modelRequests` with
 * `assetModel`) can pass their rows through without a widening cast.
 */
export type PdfModelRequest = {
  id: string;
  assetModelId: string;
  quantity: number;
  fulfilledQuantity: number;
  fulfilledAt: Date | string | null;
  assetModel: { id: string; name: string };
};

export interface PdfDbResult {
  booking: Prisma.BookingGetPayload<{
    include: {
      custodianTeamMember: true;
      custodianUser: true;
      tags: typeof TAG_WITH_COLOR_SELECT;
    };
  }>;
  /**
   * The PDF render list, ONE ROW PER `BookingAsset` slice (not one deduped row
   * per asset). A QUANTITY_TRACKED asset booked standalone + via multiple kits
   * appears once per slice, each carrying its own booked `quantity` and its own
   * `kit`. `bookingAssetId` is the unique React key for the row.
   */
  assets: (Asset & {
    category: Pick<Category, "name"> | null;
    location: Pick<Location, "name"> | null;
    kit:
      | (Pick<Kit, "id" | "name"> & { location: Pick<Location, "name"> | null })
      | null;
    /** THIS slice's booked units (`BookingAsset.quantity`). */
    quantity: number;
    /** Unique `BookingAsset.id` — the rendered row's React key. */
    bookingAssetId: string;
  })[];
  totalValue: string;
  organization: Pick<
    Organization,
    "id" | "name" | "imageId" | "currency" | "updatedAt"
  >;
  assetIdToQrCodeMap: Record<string, string>;
  /**
   * Outstanding model-level reservations on the booking (Phase 3d).
   * Only rows with `quantity > 0` are meaningful for the PDF — the
   * renderer filters defensively and omits the section entirely when
   * nothing is outstanding.
   */
  modelRequests: PdfModelRequest[];
  from?: string;
  to?: string;
  originalFrom?: string;
  originalTo?: string;
}

export async function fetchAllPdfRelatedData(
  bookingId: string,
  organizationId: string,
  userId: string,
  role: OrganizationRoles | undefined,
  request: Request,
  sortParams?: SortParams
): Promise<PdfDbResult> {
  try {
    const booking = await getBooking({
      id: bookingId,
      organizationId,
      request,
      extraInclude: { tags: TAG_WITH_COLOR_SELECT },
    });

    if (role) {
      validateBookingOwnership({
        booking,
        userId,
        role,
        action: "view",
        checkCustodianOnly: true,
      });
    }

    // Get sort params
    const orderBy = sortParams?.orderBy || "status";
    const orderDirection = sortParams?.orderDirection || "desc";

    // getBooking no longer filters by search, so honor the page's active
    // search here (in memory) — the PDF should export exactly what the user is
    // looking at. Mirrors the overview loader. We filter on the normalized
    // (singular kit/location) projection of the booking's bookingAssets. This
    // stays a PER-SLICE list (one entry per BookingAsset row: one standalone +
    // N kit-driven for a QT asset) — the PDF renders one row per slice. Each
    // slice carries its own booked `quantity` and its unique `bookingAssetId`
    // (used later as the row key); the asset ids are deduped only for the
    // efficiency of the `rawAssets` fetch below, not for the render list.
    const visibleBookingAssets = filterBookingAssets(
      (booking?.bookingAssets ?? []).map((ba) => {
        // The slice's LIVE kit membership, when the asset is still in the kit.
        const liveKit =
          ba.asset.assetKits.find((ak) => ak.id === ba.assetKitId)?.kit ?? null;
        return {
          ...ba.asset,
          // A real `Kit.id` — NOT `assetKitId`, which identifies a MEMBERSHIP
          // row and is therefore unique per (asset, kit) pair. The search
          // helper's "a matched asset surfaces its whole kit" re-expansion
          // groups on this field, so a membership id would only ever
          // re-expand the matched asset's own slices. `sourceKitId` keeps the
          // grouping intact for a slice whose membership is gone.
          kitId: liveKit?.id ?? ba.sourceKitId ?? null,
          // why: out of this rule — resolved from the live membership only.
          // Snapshot kits are fetched in the query below, which necessarily
          // runs AFTER this filter (it is keyed on the search-visible ids). A
          // detached-residue row is still surfaced by a kit-name search
          // whenever any sibling row of the same kit matches directly, since
          // re-expansion groups on the shared `kitId` above.
          kit: liveKit,
          location: getPrimaryLocation(ba.asset),
          // Slice-level fields carried through search filtering so each slice
          // renders as its own PDF row with the correct quantity/key.
          // `assetKitId` resolves the live kit, `sourceKitId` the snapshot one.
          assetKitId: ba.assetKitId,
          sourceKitId: ba.sourceKitId,
          quantity: ba.quantity,
          bookingAssetId: ba.id,
        };
      }),
      sortParams?.search
    );
    const visibleAssetIds = [...new Set(visibleBookingAssets.map((a) => a.id))];

    /**
     * Kits referenced by a visible slice's durable `BookingAsset.sourceKitId`.
     * Fetched because the PDF, unlike the booking overview, has no kit query of
     * its own — a kit only ever reaches it through `asset.assetKits`, which is
     * exactly what a detached slice no longer has.
     */
    const snapshotKitIds = [
      ...new Set(
        visibleBookingAssets
          .map((slice) => slice.sourceKitId)
          .filter((id): id is string => id !== null)
      ),
    ];

    const [rawAssets, organization, snapshotKits] = await Promise.all([
      db.asset.findMany({
        where: {
          id: { in: visibleAssetIds },
          // Defense-in-depth: scope to the caller's org even though the
          // asset ids originate from an already org-scoped booking
          organizationId,
        },
        include: {
          category: {
            select: {
              name: true,
            },
          },
          qrCodes: true,
          assetLocations: {
            select: {
              location: {
                select: {
                  name: true,
                },
              },
            },
          },
          // Each slice's `kit` / `kitId` are resolved PER SLICE below by
          // matching the slice's `BookingAsset.assetKitId` against these
          // memberships' `id` (a QT asset can be in several kits, so
          // `assetKits[0]` is not necessarily the slice's kit). `kit.location`
          // is included so `groupAndSortAssetsByKit` can sort kit groups by
          // Location in the exported PDF (otherwise every kit is treated as
          // null-location and falls back to kit-name order, making the PDF not
          // match the selected Location sort).
          assetKits: {
            select: {
              id: true,
              kit: {
                select: {
                  id: true,
                  name: true,
                  location: { select: { name: true } },
                },
              },
            },
          },
        },
      }),
      db.organization.findUnique({
        where: { id: organizationId },
        select: {
          imageId: true,
          name: true,
          id: true,
          currency: true,
          updatedAt: true,
        },
      }),
      // SECURITY (cross-org IDOR): `sourceKitId`'s FK accepts a `Kit` in ANY
      // organization, so this lookup is org-scoped and an id that doesn't
      // resolve simply leaves the slice rendering as a standalone row.
      snapshotKitIds.length > 0
        ? db.kit.findMany({
            where: { id: { in: snapshotKitIds }, organizationId },
            select: {
              id: true,
              name: true,
              // Kit location — `groupAndSortAssetsByKit` sorts kit groups by
              // it, so a snapshot kit must carry it like a live one.
              location: { select: { name: true } },
            },
          })
        : Promise.resolve<PdfSnapshotKit[]>([]),
    ]);

    if (!organization) {
      throw new ShelfError({
        cause: null,
        message: "Organization not found",
        status: 404,
        label: "Organization",
      });
    }

    // Build the PER-SLICE render list: join each search-visible BookingAsset
    // slice to its full (deduped) asset data, resolving that slice's own kit
    // and carrying its own booked quantity + unique row key. A QT asset booked
    // standalone + via two kits produces three rows here.
    const rawAssetsById = new Map(rawAssets.map((asset) => [asset.id, asset]));
    const snapshotKitsById = new Map(snapshotKits.map((kit) => [kit.id, kit]));
    const assets = buildPdfAssetRows(
      visibleBookingAssets,
      rawAssetsById,
      snapshotKitsById
    );

    // Group by kit and sort - this keeps each kit's per-slice rows contiguous.
    const sortedAssets = groupAndSortAssetsByKit(
      assets,
      orderBy,
      orderDirection
    );

    // Deduplicate by asset id before QR generation: `sortedAssets` is now
    // one row PER SLICE, so a QT asset booked standalone + via kits appears
    // several times. `getQrCodeMaps` generates a QR per row and keys the
    // result by asset id, so passing duplicates only repeats identical work —
    // pass each asset once. The render still reads the map by `asset.id`, so
    // every slice row resolves to the same (correct) QR.
    const uniqueAssetsForQr = Array.from(
      new Map(sortedAssets.map((asset) => [asset.id, asset])).values()
    );
    const assetIdToQrCodeMap = await getQrCodeMaps({
      assets: uniqueAssetsForQr,
      userId,
      organizationId,
      size: "small",
    });

    // Phase 3d (Book-by-Model): surface outstanding model-level
    // reservations so the PDF can render a dedicated "Requested models"
    // section. `getBooking` merges with `BOOKING_WITH_ASSETS_INCLUDE`
    // which already pulls `modelRequests` with `assetModel`, so this
    // pass-through is cheap — no extra database query required.
    const modelRequests: PdfModelRequest[] = (
      (booking as unknown as { modelRequests?: PdfModelRequest[] })
        .modelRequests ?? []
    )
      .filter((req) => req.fulfilledAt === null)
      .map((req) => ({
        id: req.id,
        assetModelId: req.assetModelId,
        quantity: req.quantity,
        fulfilledQuantity: req.fulfilledQuantity,
        fulfilledAt: req.fulfilledAt,
        assetModel: {
          id: req.assetModel.id,
          name: req.assetModel.name,
        },
      }));

    return {
      booking,
      assets: sortedAssets,
      // Keep the total aligned with the exported (search-filtered) rows so a
      // searched PDF doesn't show a subset of assets with a full-booking total.
      totalValue: calculateTotalValueOfAssets({
        // Sum per-slice from the `BookingAsset` pivot, scoped to the
        // search-visible asset ids. Each slice contributes its own
        // `ba.quantity` (booked units) × per-unit `valuation`, so a QT
        // asset stocked at 100 with 5 booked contributes value-for-5,
        // not value-for-100. Multi-slice (standalone + kit) sums each
        // slice independently — the deduped `sortedAssets` is the
        // rendered ROW list, not the value-summation list.
        assets: booking.bookingAssets
          .filter((ba) => visibleAssetIds.includes(ba.assetId))
          .map((ba) => ({
            valuation: ba.asset.valuation,
            bookedQuantity: ba.quantity,
          })),
        currency: organization.currency,
        locale: getClientHint(request).locale,
      }),
      organization,
      assetIdToQrCodeMap,
      modelRequests,
    };
  } catch (cause) {
    throw new ShelfError({
      cause,
      message: "Error fetching booking data for PDF",
      status: 500,
      label: "Booking",
    });
  }
}
