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
import { ASSET_MODEL_IMAGE_SELECT } from "~/modules/asset/image-select";
import type { ResolvedDisplayCode } from "~/modules/barcode/display";
import { resolveDisplayCode } from "~/modules/barcode/display";
import { validateBookingOwnership } from "~/utils/booking-authorization.server";
import { getOutstandingModelRequests } from "~/utils/booking-model-requests";
import { calculateTotalValueOfAssets } from "~/utils/bookings";
import { getClientHint } from "~/utils/client-hints";
import { ShelfError } from "~/utils/error";
import type { PdfSnapshotKit } from "./helpers";
import {
  buildPdfAssetRows,
  buildPdfBookingAssetSlices,
  filterBookingAssets,
  groupAndSortAssetsByKit,
} from "./helpers";
import { getBooking } from "./service.server";
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
    /**
     * `true` when this slice renders under a kit it is no longer a member of
     * (detached residue kept by a non-planning booking). Resolved in
     * {@link buildPdfAssetRows}; the renderer prints a short note in the Kit
     * cell, the print-medium equivalent of the web overview's
     * "Removed from kit" badge.
     */
    isRemovedFromKit: boolean;
    /** Cover image of the asset's model, rendered in the PDF when the asset
     * has no image of its own. See `~/modules/asset/image-resolution`. */
    assetModel: { image: string | null; thumbnailImage: string | null } | null;
  })[];
  totalValue: string;
  organization: Pick<
    Organization,
    | "id"
    | "name"
    | "imageId"
    | "currency"
    | "updatedAt"
    // Read by `resolveDisplayCode` when building `assetIdToDisplayCodeMap`.
    | "qrIdDisplayPreference"
    | "barcodesEnabled"
  >;
  assetIdToQrCodeMap: Record<string, string>;
  /**
   * The code to PRINT under each QR image — the same one the workspace's
   * on-screen asset lists show: the QR id, the SAM id, or a barcode value,
   * with a per-asset override winning over the workspace preference.
   *
   * Keyed by `Asset.id`, not by `bookingAssetId`: the render list is
   * per-slice, so a QUANTITY_TRACKED asset booked standalone + via kits has
   * several rows that all resolve to this one entry.
   */
  assetIdToDisplayCodeMap: Record<string, ResolvedDisplayCode>;
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
      buildPdfBookingAssetSlices(booking?.bookingAssets ?? []),
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
          // Model cover image for assets with no image of their own — the
          // exported PDF renders the same cascade as every web surface.
          ...ASSET_MODEL_IMAGE_SELECT,
          category: {
            select: {
              name: true,
            },
          },
          // why: out of this rule — `getQrCodeMaps` renders the image from
          // `Qr.version`/`errorCorrection`, so the tight select cannot be used.
          qrCodes: true,
          // Feeds `resolveDisplayCode` so a barcode-preference workspace gets
          // its barcode value printed instead of the QR id.
          barcodes: { select: { id: true, type: true, value: true } },
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
          // Which code the workspace wants printed under the QR image.
          qrIdDisplayPreference: true,
          barcodesEnabled: true,
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

    // Resolve the printed code once per unique asset, over the same deduped
    // list the QR images are generated from. Resolving per rendered row would
    // repeat identical work for every slice of a QUANTITY_TRACKED asset and
    // would have to be threaded through `PdfAssetRow`; a map keyed by asset id
    // leaves the row types untouched.
    const assetIdToDisplayCodeMap: Record<string, ResolvedDisplayCode> =
      Object.fromEntries(
        uniqueAssetsForQr.map((asset) => [
          asset.id,
          resolveDisplayCode({
            entity: asset,
            organization,
            entityKind: "asset",
          }),
        ])
      );

    // Phase 3d (Book-by-Model): surface outstanding model-level
    // reservations so the PDF can render a dedicated "Requested models"
    // section. `getBooking` merges with `BOOKING_WITH_ASSETS_INCLUDE`
    // which already pulls `modelRequests` with `assetModel`, so this
    // pass-through is cheap — no extra database query required.
    const modelRequests: PdfModelRequest[] = getOutstandingModelRequests(
      (booking as unknown as { modelRequests?: PdfModelRequest[] })
        .modelRequests
    ).map((req) => ({
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

    // Everything dropped here is fetch-only. The code relations have done their
    // job in the two maps above; `assetKits` and `assetLocations` were reduced
    // to this row's `kit` and `location` by `buildPdfAssetRows`. Nothing reads
    // any of them again, here or in the browser, and the render list is one row
    // per SLICE — so a QUANTITY_TRACKED asset booked standalone and through
    // three kits would otherwise serialise four copies of each.
    const printableAssets = sortedAssets.map(
      ({
        qrCodes: _qrCodes,
        barcodes: _barcodes,
        assetKits: _assetKits,
        assetLocations: _assetLocations,
        ...row
      }) => row
    );

    // `getBooking` returns the whole booking, and its `bookingAssets` carry a
    // second, full copy of every asset — code relations included — once per
    // slice. The sheet reads the booking only for its name, description,
    // custodian and tags; `assets` above is the per-slice view it renders.
    const { bookingAssets: _bookingAssets, ...printableBooking } = booking;

    return {
      booking: printableBooking,
      assets: printableAssets,
      // Keep the total aligned with the exported (search-filtered) rows so a
      // searched PDF doesn't show a subset of assets with a full-booking total.
      totalValue: calculateTotalValueOfAssets({
        // Sum per-slice over EXACTLY the search-visible slices — the same
        // `visibleBookingAssets` list `buildPdfAssetRows` renders above — so
        // the total can never diverge from the exported rows. Scoping by asset
        // id instead folds in an asset's OTHER, non-visible slices: e.g. a QT
        // item shown only via a re-expanded kit slice would wrongly add its
        // hidden standalone slice's value (#2811 review). Each slice
        // contributes its own booked `quantity` × per-unit `valuation`, so a QT
        // asset stocked at 100 with 5 booked contributes value-for-5, not 100.
        assets: visibleBookingAssets.map((slice) => ({
          valuation: slice.valuation,
          bookedQuantity: slice.quantity,
        })),
        currency: organization.currency,
        locale: getClientHint(request).locale,
      }),
      organization,
      assetIdToQrCodeMap,
      assetIdToDisplayCodeMap,
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
