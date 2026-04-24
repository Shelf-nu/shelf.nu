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
import { groupAndSortAssetsByKit } from "./helpers";
import { getBooking } from "./service.server";
import { getQrCodeMaps } from "../qr/service.server";
import { TAG_WITH_COLOR_SELECT } from "../tag/constants";

export interface SortParams {
  orderBy?: string;
  orderDirection?: "asc" | "desc";
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
  assets: (Asset & {
    category: Pick<Category, "name"> | null;
    location: Pick<Location, "name"> | null;
    kit: Pick<Kit, "name"> | null;
  })[];
  totalValue: string;
  organization: Pick<
    Organization,
    "id" | "name" | "imageId" | "currency" | "updatedAt"
  >;
  assetIdToQrCodeMap: Record<string, string>;
  /** Maps asset ID to booked quantity for quantity-tracked assets */
  assetIdToQuantityMap: Record<string, number>;
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

    const [assets, organization] = await Promise.all([
      db.asset.findMany({
        where: {
          id: {
            in: booking?.bookingAssets.map((ba) => ba.assetId) || [],
          },
        },
        include: {
          category: {
            select: {
              name: true,
            },
          },
          qrCodes: true,
          location: {
            select: {
              name: true,
            },
          },
          kit: {
            select: {
              name: true,
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
    ]);

    if (!organization) {
      throw new ShelfError({
        cause: null,
        message: "Organization not found",
        status: 404,
        label: "Organization",
      });
    }

    // Group by kit and sort - this ensures kit assets stay together
    const sortedAssets = groupAndSortAssetsByKit(
      assets,
      orderBy,
      orderDirection
    );

    const assetIdToQrCodeMap = await getQrCodeMaps({
      assets: sortedAssets,
      userId,
      organizationId,
      size: "small",
    });

    // Build a map of asset ID to booked quantity from the pivot records.
    // Only entries with quantity > 1 are meaningful (QUANTITY_TRACKED assets).
    const assetIdToQuantityMap: Record<string, number> = {};
    for (const ba of booking.bookingAssets) {
      if (ba.quantity > 1) {
        assetIdToQuantityMap[ba.assetId] = ba.quantity;
      }
    }

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
      totalValue: calculateTotalValueOfAssets({
        assets: booking.bookingAssets.map((ba) => ba.asset),
        currency: organization.currency,
        locale: getClientHint(request).locale,
      }),
      organization,
      assetIdToQrCodeMap,
      assetIdToQuantityMap,
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
