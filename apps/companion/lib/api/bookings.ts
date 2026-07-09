import { apiFetch } from "./client";
import type {
  BookingsResponse,
  BookingDetailResponse,
  BookingActionResponse,
  CheckinDisposition,
  CheckoutDisposition,
  PartialCheckinResponse,
  PartialCheckoutResponse,
  BookingMutationResponse,
  CreateBookingPayload,
  UpdateBookingPayload,
  RemoveBookingAssetsResponse,
  AvailableAssetsResponse,
  AvailableKitsResponse,
  AvailableModelsResponse,
  ModelRequestMutationResponse,
  BookingTagsResponse,
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
    timeZone?: string,
    checkins?: CheckinDisposition[]
  ) =>
    apiFetch<PartialCheckinResponse>(
      `/api/mobile/bookings/partial-checkin?orgId=${orgId}`,
      {
        method: "POST",
        body: JSON.stringify({ bookingId, assetIds, checkins, timeZone }),
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
    timeZone?: string,
    checkouts?: CheckoutDisposition[]
  ) =>
    apiFetch<PartialCheckoutResponse>(
      `/api/mobile/bookings/partial-checkout?orgId=${orgId}`,
      {
        method: "POST",
        body: JSON.stringify({ bookingId, assetIds, checkouts, timeZone }),
      }
    ),

  /** Create a booking (always DRAFT). Assets/kits are added afterwards. */
  createBooking: (orgId: string, payload: CreateBookingPayload) =>
    apiFetch<BookingMutationResponse>(
      `/api/mobile/bookings/create?orgId=${orgId}`,
      {
        method: "POST",
        body: JSON.stringify(payload),
      }
    ),

  /** Edit a booking's basic info (status-aware field mask applied server-side). */
  updateBooking: (orgId: string, payload: UpdateBookingPayload) =>
    apiFetch<BookingMutationResponse>(
      `/api/mobile/bookings/update?orgId=${orgId}`,
      {
        method: "POST",
        body: JSON.stringify(payload),
      }
    ),

  /** Reserve a DRAFT booking (DRAFT -> RESERVED, conflict-checked server-side). */
  reserveBooking: (orgId: string, bookingId: string, timeZone: string) =>
    apiFetch<BookingMutationResponse>(
      `/api/mobile/bookings/reserve?orgId=${orgId}`,
      {
        method: "POST",
        body: JSON.stringify({ bookingId, timeZone }),
      }
    ),

  /** Remove assets and/or kits from a booking (kits expand server-side). */
  removeAssets: (
    orgId: string,
    bookingId: string,
    assetIds: string[],
    kitIds: string[] = []
  ) =>
    apiFetch<RemoveBookingAssetsResponse>(
      `/api/mobile/bookings/remove-assets?orgId=${orgId}`,
      {
        method: "POST",
        body: JSON.stringify({ bookingId, assetIds, kitIds }),
      }
    ),

  /**
   * Cancel a booking (RESERVED/ONGOING/OVERDUE -> CANCELLED). Frees the
   * assets/kits; status guard + ownership enforced server-side.
   */
  cancelBooking: (
    orgId: string,
    bookingId: string,
    cancellationReason?: string
  ) =>
    apiFetch<BookingMutationResponse>(
      `/api/mobile/bookings/cancel?orgId=${orgId}`,
      {
        method: "POST",
        body: JSON.stringify({ bookingId, cancellationReason }),
      }
    ),

  /** Archive a COMPLETE booking (-> ARCHIVED). COMPLETE-only, enforced server-side. */
  archiveBooking: (orgId: string, bookingId: string) =>
    apiFetch<BookingMutationResponse>(
      `/api/mobile/bookings/archive?orgId=${orgId}`,
      {
        method: "POST",
        body: JSON.stringify({ bookingId }),
      }
    ),

  /** Permanently delete a booking (ownership + BASE-only-DRAFT enforced server-side). */
  deleteBooking: (orgId: string, bookingId: string) =>
    apiFetch<{ success: boolean }>(
      `/api/mobile/bookings/delete?orgId=${orgId}`,
      {
        method: "POST",
        body: JSON.stringify({ bookingId }),
      }
    ),

  /**
   * Duplicate a booking into a fresh DRAFT and return the new booking, so the
   * app can navigate straight into editing it.
   */
  duplicateBooking: (orgId: string, bookingId: string) =>
    apiFetch<BookingMutationResponse>(
      `/api/mobile/bookings/duplicate?orgId=${orgId}`,
      {
        method: "POST",
        body: JSON.stringify({ bookingId }),
      }
    ),

  /**
   * Availability-aware asset picker for the [from,to] window. `bookingFrom` /
   * `bookingTo` are ISO strings; `unhideBookingId` keeps the booking's own
   * assets visible when editing (so they aren't filtered out as "unavailable").
   */
  availableAssets: (
    orgId: string,
    params: {
      bookingFrom: string;
      bookingTo: string;
      unhideBookingId?: string;
      search?: string;
      page?: number;
    }
  ) => {
    const sp = new URLSearchParams({ orgId });
    sp.set("bookingFrom", params.bookingFrom);
    sp.set("bookingTo", params.bookingTo);
    sp.set("hideUnavailable", "true");
    if (params.unhideBookingId)
      sp.set("unhideAssetsBookigIds", params.unhideBookingId);
    if (params.search) sp.set("s", params.search);
    if (params.page) sp.set("page", String(params.page));
    return apiFetch<AvailableAssetsResponse>(
      `/api/mobile/bookings/available-assets?${sp}`
    );
  },

  /** Availability-aware kit picker for the [from,to] window. */
  availableKits: (
    orgId: string,
    params: {
      bookingFrom: string;
      bookingTo: string;
      /** The booking being edited — REQUIRED for the kit conflict filter to run
       * (service gates on `currentBookingId && hideUnavailable`) and to keep this
       * booking's own kits selectable. */
      currentBookingId?: string;
      search?: string;
      page?: number;
    }
  ) => {
    const sp = new URLSearchParams({ orgId });
    sp.set("bookingFrom", params.bookingFrom);
    sp.set("bookingTo", params.bookingTo);
    sp.set("hideUnavailable", "true");
    if (params.currentBookingId)
      sp.set("currentBookingId", params.currentBookingId);
    if (params.search) sp.set("s", params.search);
    if (params.page) sp.set("page", String(params.page));
    return apiFetch<AvailableKitsResponse>(
      `/api/mobile/bookings/available-kits?${sp}`
    );
  },

  /** Tags assignable to bookings (for the booking-form tag picker). */
  bookingTags: (orgId: string) =>
    apiFetch<BookingTagsResponse>(`/api/mobile/bookings/tags?orgId=${orgId}`),

  /**
   * Book-by-model picker: the workspace's asset models with how many units are
   * free to reserve in this booking's window, plus the booking's existing
   * model reservations (to pre-fill inputs). Read-only. `search` filters by
   * model name server-side so orgs with more than ~50 models can reach any
   * of them (the list is capped, so a client-only filter can't).
   */
  availableModels: (orgId: string, bookingId: string, search?: string) => {
    const sp = new URLSearchParams({ orgId, bookingId });
    if (search) sp.set("s", search);
    return apiFetch<AvailableModelsResponse>(
      `/api/mobile/bookings/available-models?${sp}`
    );
  },

  /**
   * Reserve (or edit) `quantity` units of an asset model on a booking.
   * `quantity` is the ABSOLUTE reserved total, not a delta — the server upserts
   * to it. DRAFT/RESERVED only; availability + ownership enforced server-side.
   */
  upsertModelRequest: (
    orgId: string,
    bookingId: string,
    assetModelId: string,
    quantity: number
  ) =>
    apiFetch<ModelRequestMutationResponse>(
      `/api/mobile/bookings/${bookingId}/model-requests?orgId=${orgId}`,
      {
        method: "POST",
        body: JSON.stringify({ assetModelId, quantity }),
      }
    ),

  /**
   * Cancel a model-level reservation on a booking. Idempotent; blocked
   * server-side if units have already been assigned (edit the quantity down
   * instead). DRAFT/RESERVED only.
   */
  removeModelRequest: (
    orgId: string,
    bookingId: string,
    assetModelId: string
  ) =>
    apiFetch<ModelRequestMutationResponse>(
      `/api/mobile/bookings/${bookingId}/model-requests?orgId=${orgId}`,
      {
        method: "DELETE",
        body: JSON.stringify({ assetModelId }),
      }
    ),
};
