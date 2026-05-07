import { apiFetch } from "./client";
import type {
  BookingsResponse,
  BookingDetailResponse,
  BookingActionResponse,
  PartialCheckinResponse,
} from "./types";

export const bookingsApi = {
  /** Get paginated bookings for an organization */
  bookings: (
    orgId: string,
    params?: { status?: string; page?: number; perPage?: number }
  ) => {
    const searchParams = new URLSearchParams({ orgId });
    if (params?.status) searchParams.set("status", params.status);
    if (params?.page) searchParams.set("page", String(params.page));
    if (params?.perPage) searchParams.set("perPage", String(params.perPage));
    return apiFetch<BookingsResponse>(`/api/mobile/bookings?${searchParams}`);
  },

  /** Get full booking details with assets */
  booking: (bookingId: string, orgId: string) =>
    apiFetch<BookingDetailResponse>(
      `/api/mobile/bookings/${bookingId}?orgId=${orgId}`
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
};
