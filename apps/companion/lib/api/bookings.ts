import { apiFetch } from "./client";
import type {
  BookingsResponse,
  BookingDetailResponse,
  BookingActionResponse,
  PartialCheckinResponse,
  PartialCheckoutResponse,
} from "./types";

export const bookingsApi = {
  /** Get paginated bookings for an organization */
  bookings: (
    orgId: string,
    params?: {
      status?: string;
      page?: number;
      perPage?: number;
      search?: string;
      sortBy?: string;
      sortOrder?: "asc" | "desc";
    }
  ) => {
    const searchParams = new URLSearchParams({ orgId });
    if (params?.status) searchParams.set("status", params.status);
    if (params?.page) searchParams.set("page", String(params.page));
    if (params?.perPage) searchParams.set("perPage", String(params.perPage));
    if (params?.search) searchParams.set("search", params.search);
    if (params?.sortBy) searchParams.set("sortBy", params.sortBy);
    if (params?.sortOrder) searchParams.set("sortOrder", params.sortOrder);
    return apiFetch<BookingsResponse>(`/api/mobile/bookings?${searchParams}`);
  },

  /** Get full booking details with assets */
  booking: (bookingId: string, orgId: string) =>
    apiFetch<BookingDetailResponse>(
      `/api/mobile/bookings/${bookingId}?orgId=${orgId}`
    ),

  /**
   * Add scanned assets and/or kits to a booking (scan-to-build flow).
   * Kits expand to their contained assets server-side, mirroring the web
   * scanner's add-to-booking drawer.
   */
  addScannedToBooking: (
    orgId: string,
    bookingId: string,
    assetIds: string[],
    kitIds: string[]
  ) =>
    apiFetch<{ success: boolean }>(
      `/api/mobile/bookings/add-scanned-assets?orgId=${orgId}`,
      {
        method: "POST",
        body: JSON.stringify({ bookingId, assetIds, kitIds }),
      }
    ),

  /** Check out a booking (RESERVED -> ONGOING) */
  checkoutBooking: (orgId: string, bookingId: string, timeZone?: string) =>
    apiFetch<BookingActionResponse>(
      `/api/mobile/bookings/checkout?orgId=${orgId}`,
      {
        method: "POST",
        body: JSON.stringify({ bookingId, timeZone }),
      }
    ),

  /** Full check-in (ONGOING -> COMPLETE) */
  checkinBooking: (orgId: string, bookingId: string, timeZone?: string) =>
    apiFetch<BookingActionResponse>(
      `/api/mobile/bookings/checkin?orgId=${orgId}`,
      {
        method: "POST",
        body: JSON.stringify({ bookingId, timeZone }),
      }
    ),

  /** Partial check-in: check in specific assets */
  partialCheckinBooking: (
    orgId: string,
    bookingId: string,
    assetIds: string[],
    timeZone?: string
  ) =>
    apiFetch<PartialCheckinResponse>(
      `/api/mobile/bookings/partial-checkin?orgId=${orgId}`,
      {
        method: "POST",
        body: JSON.stringify({ bookingId, assetIds, timeZone }),
      }
    ),

  /**
   * Partial check-out: check out a subset of a booking's assets (progressive
   * check-out — "take some now"). The first checkout transitions the booking to
   * ONGOING; the rest stay reserved until checked out. Mirrors
   * {@link partialCheckinBooking}.
   */
  partialCheckoutBooking: (
    orgId: string,
    bookingId: string,
    assetIds: string[],
    timeZone?: string
  ) =>
    apiFetch<PartialCheckoutResponse>(
      `/api/mobile/bookings/partial-checkout?orgId=${orgId}`,
      {
        method: "POST",
        body: JSON.stringify({ bookingId, assetIds, timeZone }),
      }
    ),
};
