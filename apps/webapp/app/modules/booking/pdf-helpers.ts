import type {
  Asset,
  Location,
  Category,
  Organization,
  Prisma,
  Kit,
  OrganizationRoles,
} from "@prisma/client";
import type { Sb } from "@shelf/database";
import { sbDb } from "~/database/supabase.server";
import { validateBookingOwnership } from "~/utils/booking-authorization.server";
import { calculateTotalValueOfAssets } from "~/utils/bookings";
import { getClientHint } from "~/utils/client-hints";
import { ShelfError } from "~/utils/error";
import { groupAndSortAssetsByKit } from "./helpers";
import { getBooking } from "./service.server";
import { getQrCodeMaps } from "../qr/service.server";
import { TAG_WITH_COLOR_SELECT } from "../tag/constants";

/** Shape of an asset row from Supabase with joined relations for the PDF query */
type SbAssetWithRelations = Sb.AssetRow & {
  category: { name: string } | null;
  qrCodes: Sb.QrRow[];
  location: { name: string } | null;
  kit: { name: string } | null;
};

export interface SortParams {
  orderBy?: string;
  orderDirection?: "asc" | "desc";
}

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

    const assetIds = booking?.assets.map((a) => a.id) || [];

    const [assetsResult, organizationResult] = await Promise.all([
      sbDb
        .from("Asset")
        .select(
          "*, category:Category(name), qrCodes:Qr(*), location:Location(name), kit:Kit(name)"
        )
        .in("id", assetIds),
      sbDb
        .from("Organization")
        .select("imageId, name, id, currency, updatedAt")
        .eq("id", organizationId)
        .maybeSingle(),
    ]);

    if (assetsResult.error) throw assetsResult.error;
    if (organizationResult.error) throw organizationResult.error;

    const assets = assetsResult.data as unknown as SbAssetWithRelations[];
    const organizationData = organizationResult.data;

    if (!organizationData) {
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

    const organization = {
      ...organizationData,
      updatedAt: new Date(organizationData.updatedAt),
    };

    return {
      booking,
      assets: sortedAssets as unknown as PdfDbResult["assets"],
      totalValue: calculateTotalValueOfAssets({
        assets: booking.assets,
        currency: organization.currency,
        locale: getClientHint(request).locale,
      }),
      organization,
      assetIdToQrCodeMap,
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
