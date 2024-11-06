import type { BookingStatus, Organization, Prisma } from "@prisma/client";
import type { HeaderData } from "~/components/layout/header/types";
import { getClientHint, getDateTimeFormat } from "~/utils/client-hints";
import type { ResponsePayload } from "~/utils/http.server";
import { getCurrentSearchParams } from "~/utils/http.server";
import { getParamsValues } from "~/utils/list";
// eslint-disable-next-line import/no-cycle
import { getBookings } from "./service.server";

export function getBookingWhereInput({
  organizationId,
  currentSearchParams,
}: {
  organizationId: Organization["id"];
  currentSearchParams?: string | null;
}): Prisma.BookingWhereInput {
  const where: Prisma.BookingWhereInput = { organizationId };

  if (!currentSearchParams) {
    return where;
  }

  const searchParams = new URLSearchParams(currentSearchParams);

  const status =
    searchParams.get("status") === "ALL"
      ? null
      : (searchParams.get("status") as BookingStatus);

  if (status) {
    where.status = status;
  }

  return where;
}

interface LoadBookingsParams {
  request: Request;
  organizationId: string;
  userId: string;
  isSelfServiceOrBase: boolean;
  ids?: string[];
}

/**
 * Base interface for booking loader response
 */
interface BaseBookingLoaderResponse {
  showModal: boolean;
  header: HeaderData;
  bookings: any[];
  search: string | null;
  page: number;
  bookingCount: number;
  totalPages: number;
  perPage: number;
  modelName: {
    singular: string;
    plural: string;
  };
  ids?: string[];
  hints: any;
}

/**
 * Combined type for booking loader response that includes ResponsePayload requirements
 */
type BookingLoaderResponse = BaseBookingLoaderResponse & ResponsePayload;

/**
 * Shared function to load booking data for both assets and kits routes for add-to-existing-booking
 * @param params - Parameters required for loading bookings
 * @returns Formatted booking data response
 */
export async function loadBookingsData({
  request,
  organizationId,
  userId,
  isSelfServiceOrBase,
  ids,
}: LoadBookingsParams): Promise<BookingLoaderResponse> {
  // Get search parameters and pagination settings
  const searchParams = getCurrentSearchParams(request);
  const { page, search } = getParamsValues(searchParams);
  const perPage = 20;

  // Fetch bookings with filters
  const { bookings, bookingCount } = await getBookings({
    organizationId,
    page,
    perPage,
    search,
    userId,
    statuses: ["DRAFT", "RESERVED"],
    ...(isSelfServiceOrBase && {
      custodianUserId: userId,
    }),
  });

  // Set up header and model name
  const header: HeaderData = {
    title: "Bookings",
  };

  const modelName = {
    singular: "booking",
    plural: "bookings",
  };

  const totalPages = Math.ceil(bookingCount / perPage);
  const hints = getClientHint(request);

  // Format booking dates
  const items = bookings.map((b) => {
    if (b.from && b.to) {
      const from = new Date(b.from);
      const displayFrom = getDateTimeFormat(request, {
        dateStyle: "short",
        timeStyle: "short",
      }).format(from);

      const to = new Date(b.to);
      const displayTo = getDateTimeFormat(request, {
        dateStyle: "short",
        timeStyle: "short",
      }).format(to);

      return {
        ...b,
        displayFrom: displayFrom.split(","),
        displayTo: displayTo.split(","),
        metadata: {
          ...b,
          displayFrom: displayFrom.split(","),
          displayTo: displayTo.split(","),
        },
      };
    }
    return b;
  });

  return {
    showModal: true,
    header,
    bookings: items,
    search,
    page,
    bookingCount,
    totalPages,
    perPage,
    modelName,
    ids,
    hints,
  };
}
