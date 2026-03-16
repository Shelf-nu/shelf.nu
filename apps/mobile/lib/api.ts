import { supabase } from "./supabase";

/**
 * Base URL for the Shelf webapp API.
 * In development, this is your local dev server.
 * In production, this would be the deployed webapp URL.
 */
export const API_BASE_URL =
  process.env.EXPO_PUBLIC_API_URL || "http://localhost:3000";
if (__DEV__) console.log("[API] Base URL:", API_BASE_URL);

/**
 * Global auth error listener.
 * Screens can subscribe to be notified when the session expires
 * so they can redirect to the login screen.
 */
type AuthErrorListener = () => void;
const authErrorListeners = new Set<AuthErrorListener>();
export function onAuthError(listener: AuthErrorListener): () => void {
  authErrorListeners.add(listener);
  return () => authErrorListeners.delete(listener);
}
function notifyAuthError() {
  authErrorListeners.forEach((fn) => fn());
}

/** Default request timeout (20 seconds — generous for first cold-start request) */
const REQUEST_TIMEOUT_MS = 20_000;

/** Max automatic retries for timeout/network errors */
const MAX_RETRIES = 1;

// ── Response cache for low-churn data ───────────────────
// Team members, locations, and categories rarely change during a session.
// Caching these responses avoids redundant network calls when pickers
// are opened multiple times (e.g. assign custody → change location).
const RESPONSE_CACHE_TTL_MS = 5 * 60_000; // 5 minutes
const responseCache = new Map<string, { data: unknown; cachedAt: number }>();

/** Clear all cached API responses (call after mutations that affect cached data). */
export function invalidateResponseCache(keyPrefix?: string) {
  if (!keyPrefix) {
    responseCache.clear();
    return;
  }
  for (const key of responseCache.keys()) {
    if (key.startsWith(keyPrefix)) responseCache.delete(key);
  }
}

/** Wraps apiFetch with in-memory caching for GET requests. */
async function cachedApiFetch<T>(
  path: string,
  ttl: number = RESPONSE_CACHE_TTL_MS
): Promise<{ data: T | null; error: string | null }> {
  const now = Date.now();
  const cached = responseCache.get(path);
  if (cached && now - cached.cachedAt < ttl) {
    return { data: cached.data as T, error: null };
  }
  const result = await apiFetch<T>(path);
  if (result.data && !result.error) {
    responseCache.set(path, { data: result.data, cachedAt: Date.now() });
  }
  return result;
}

// ── Session cache ──────────────────────────────────────
// Cache the Supabase session in memory to avoid repeated SecureStore reads.
// Each getSession() call reads encrypted data from disk (2-3 chunks on iOS).
// With dozens of API calls per navigation, this eliminates massive I/O overhead.
const SESSION_CACHE_TTL_MS = 30_000; // 30 seconds
let cachedAccessToken: string | null = null;
let cachedAt = 0;

// Invalidate cache when auth state changes (login, logout, token refresh)
supabase.auth.onAuthStateChange(() => {
  cachedAccessToken = null;
  cachedAt = 0;
});

/** Returns a valid access token, using cache when possible. */
async function getAccessToken(): Promise<string | null> {
  const now = Date.now();
  if (cachedAccessToken && now - cachedAt < SESSION_CACHE_TTL_MS) {
    return cachedAccessToken;
  }
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (session?.access_token) {
    cachedAccessToken = session.access_token;
    cachedAt = now;
    return cachedAccessToken;
  }
  cachedAccessToken = null;
  cachedAt = 0;
  return null;
}

/**
 * Makes an authenticated API call to the Shelf webapp.
 * Automatically attaches the current Supabase session JWT.
 * - Returns structured { data, error } — never throws.
 * - Detects 401/session-expired and notifies global auth listeners.
 * - Enforces a request timeout to avoid hanging on slow networks.
 */
async function apiFetch<T>(
  path: string,
  options: RequestInit = {},
  _retryCount = 0
): Promise<{ data: T | null; error: string | null }> {
  // Declared outside try so catch block can read it
  let timedOut = false;

  try {
    const accessToken = await getAccessToken();

    if (!accessToken) {
      notifyAuthError();
      return { data: null, error: "Session expired. Please sign in again." };
    }

    const url = `${API_BASE_URL}${path}`;
    if (__DEV__)
      console.log(
        "[API] Fetching:",
        url,
        _retryCount > 0 ? `(retry ${_retryCount})` : ""
      );

    // Abort controller for timeout — tag it so we can distinguish
    // timeout aborts from user/navigation aborts
    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, REQUEST_TIMEOUT_MS);

    // If caller provided a signal (e.g. from useEffect cleanup), chain it
    if (options.signal) {
      options.signal.addEventListener("abort", () => controller.abort());
    }

    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
        ...options.headers,
      },
    });
    clearTimeout(timeoutId);

    // Safe JSON parsing — server may return HTML error pages or empty body
    let json: any;
    try {
      const text = await response.text();
      json = text ? JSON.parse(text) : null;
    } catch {
      if (!response.ok) {
        return { data: null, error: `Server error (${response.status})` };
      }
      return { data: null, error: "Invalid response from server" };
    }

    if (!response.ok) {
      // 401 = unauthenticated → session expired, redirect to login
      if (response.status === 401) {
        notifyAuthError();
        return {
          data: null,
          error: "Session expired. Please sign in again.",
        };
      }
      // 403 = forbidden → user lacks permission, but session is valid
      if (response.status === 403) {
        return {
          data: null,
          error:
            json?.error?.message ||
            "You don't have permission to perform this action.",
        };
      }
      return {
        data: null,
        error: json?.error?.message || `Request failed (${response.status})`,
      };
    }

    return { data: json as T, error: null };
  } catch (err) {
    // Navigation/cleanup abort — silently return null (not an error)
    if (err instanceof Error && err.name === "AbortError" && !timedOut) {
      if (__DEV__) console.log("[API] Request cancelled (navigation):", path);
      return { data: null, error: null };
    }

    if (__DEV__) console.error("[API] Fetch error:", err);

    // Auto-retry on timeout or network errors (not on auth/permission errors)
    const isRetryable =
      (err instanceof Error && err.name === "AbortError" && timedOut) ||
      err instanceof TypeError; // TypeError = network failure
    if (isRetryable && _retryCount < MAX_RETRIES) {
      if (__DEV__) console.log("[API] Retrying…", path);
      return apiFetch<T>(path, options, _retryCount + 1);
    }

    if (err instanceof Error && err.name === "AbortError") {
      return { data: null, error: "Request timed out. Check your connection." };
    }
    return {
      data: null,
      error: err instanceof Error ? err.message : "Network request failed",
    };
  }
}

/**
 * Makes an authenticated multipart upload to the Shelf webapp.
 * Used for image uploads where we send FormData instead of JSON.
 */
async function apiUpload<T>(
  path: string,
  formData: FormData
): Promise<{ data: T | null; error: string | null }> {
  try {
    const accessToken = await getAccessToken();

    if (!accessToken) {
      notifyAuthError();
      return { data: null, error: "Session expired. Please sign in again." };
    }

    const url = `${API_BASE_URL}${path}`;
    if (__DEV__) console.log("[API] Uploading to:", url);

    // Abort controller for timeout (longer than regular fetch for uploads)
    const controller = new AbortController();
    const timeoutId = setTimeout(
      () => controller.abort(),
      REQUEST_TIMEOUT_MS * 4
    );

    const response = await fetch(url, {
      method: "POST",
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        // Do NOT set Content-Type — fetch auto-sets it with the multipart boundary
      },
      body: formData,
    });
    clearTimeout(timeoutId);

    // Safe JSON parsing — server may return HTML error pages or empty body
    let json: any;
    try {
      const text = await response.text();
      json = text ? JSON.parse(text) : null;
    } catch {
      if (!response.ok) {
        return { data: null, error: `Upload failed (${response.status})` };
      }
      return { data: null, error: "Invalid response from server" };
    }

    if (!response.ok) {
      if (response.status === 401) {
        notifyAuthError();
        return { data: null, error: "Session expired. Please sign in again." };
      }
      if (response.status === 403) {
        return {
          data: null,
          error:
            json?.error?.message ||
            "You don't have permission to perform this action.",
        };
      }
      return {
        data: null,
        error: json?.error?.message || `Upload failed (${response.status})`,
      };
    }

    return { data: json as T, error: null };
  } catch (err) {
    if (__DEV__) console.error("[API] Upload error:", err);
    if (err instanceof Error && err.name === "AbortError") {
      return { data: null, error: "Upload timed out. Check your connection." };
    }
    return {
      data: null,
      error: err instanceof Error ? err.message : "Upload failed",
    };
  }
}

// ── Types ──────────────────────────────────────────────

export type Organization = {
  id: string;
  name: string;
  type: string;
  roles: string[];
  barcodesEnabled: boolean;
};

export type MeResponse = {
  user: {
    id: string;
    email: string;
    firstName: string | null;
    lastName: string | null;
    profilePicture: string | null;
  };
  organizations: Organization[];
};

export type AssetListItem = {
  id: string;
  title: string;
  status: string;
  mainImage: string | null;
  thumbnailImage: string | null;
  category: { id: string; name: string } | null;
  location: { id: string; name: string } | null;
  custody: { custodian: { id: string; name: string } } | null;
};

export type AssetsResponse = {
  assets: AssetListItem[];
  page: number;
  perPage: number;
  totalCount: number;
  totalPages: number;
};

export type AssetNote = {
  id: string;
  content: string;
  type: "COMMENT" | "UPDATE";
  createdAt: string;
  user: {
    firstName: string | null;
    lastName: string | null;
  } | null;
};

export type AssetDetail = {
  id: string;
  title: string;
  description: string | null;
  status: string;
  mainImage: string | null;
  thumbnailImage: string | null;
  availableToBook: boolean;
  valuation: number | null;
  createdAt: string;
  updatedAt: string;
  organizationId: string;
  category: { id: string; name: string; color: string } | null;
  location: { id: string; name: string } | null;
  custody: {
    createdAt: string;
    custodian: {
      id: string;
      name: string;
      user: {
        firstName: string | null;
        lastName: string | null;
        email: string;
        profilePicture: string | null;
      } | null;
    };
  } | null;
  kit: { id: string; name: string; status: string } | null;
  tags: { id: string; name: string }[];
  qrCodes: { id: string }[];
  organization: { currency: string };
  notes: AssetNote[];
  customFields: {
    id: string;
    value: any;
    customField: {
      id: string;
      name: string;
      type: string;
      helpText: string | null;
      active: boolean;
    };
  }[];
};

export type QrResponse = {
  qr: {
    id: string;
    assetId: string | null;
    kitId: string | null;
    organizationId: string | null;
    asset: {
      id: string;
      title: string;
      status: string;
      mainImage: string | null;
      category: { name: string } | null;
      location: { name: string } | null;
    } | null;
  };
};

export type BarcodeResponse = {
  barcode: {
    id: string;
    value: string;
    type: string;
    assetId: string | null;
    kitId: string | null;
    organizationId: string;
    asset: {
      id: string;
      title: string;
      status: string;
      mainImage: string | null;
      category: { name: string } | null;
      location: { name: string } | null;
    } | null;
  };
};

export type TeamMember = {
  id: string;
  name: string;
  user: {
    id: string;
    firstName: string | null;
    lastName: string | null;
    profilePicture: string | null;
  } | null;
};

export type TeamMembersResponse = {
  teamMembers: TeamMember[];
};

export type Location = {
  id: string;
  name: string;
  description: string | null;
  image: string | null;
  parentId: string | null;
};

export type LocationsResponse = {
  locations: Location[];
};

export type CustodyResponse = {
  asset: {
    id: string;
    title: string;
    status: string;
    custody: {
      custodian: { id: string; name: string };
    } | null;
  };
};

export type UpdateLocationResponse = {
  asset: {
    id: string;
    title: string;
    location: { id: string; name: string } | null;
  };
};

export type UpdateImageResponse = {
  asset: {
    id: string;
    title: string;
    mainImage: string | null;
    thumbnailImage: string | null;
  };
};

export type BulkActionResponse = {
  success: boolean;
  assigned?: number;
  released?: number;
  updated?: number;
  skipped?: number;
};

export type BookingStatus =
  | "DRAFT"
  | "RESERVED"
  | "ONGOING"
  | "OVERDUE"
  | "COMPLETE"
  | "ARCHIVED"
  | "CANCELLED";

export type BookingListItem = {
  id: string;
  name: string;
  status: BookingStatus;
  from: string;
  to: string;
  createdAt: string;
  custodianName: string | null;
  custodianImage: string | null;
  assetCount: number;
};

export type BookingsResponse = {
  bookings: BookingListItem[];
  page: number;
  perPage: number;
  totalCount: number;
  totalPages: number;
};

export type BookingAsset = {
  id: string;
  title: string;
  status: string;
  mainImage: string | null;
  kitId: string | null;
  category: { id: string; name: string; color: string } | null;
  kit: { id: string; name: string } | null;
};

export type BookingDetail = {
  id: string;
  name: string;
  description: string | null;
  status: BookingStatus;
  from: string;
  to: string;
  createdAt: string;
  updatedAt: string;
  creator: {
    id: string;
    firstName: string | null;
    lastName: string | null;
  };
  custodianUser: {
    id: string;
    firstName: string | null;
    lastName: string | null;
    profilePicture: string | null;
  } | null;
  custodianTeamMember: {
    id: string;
    name: string;
  } | null;
  assets: BookingAsset[];
  assetCount: number;
  checkedOutCount: number;
};

export type BookingDetailResponse = {
  booking: BookingDetail;
  checkedInAssetIds: string[];
  canCheckout: boolean;
  canCheckin: boolean;
};

export type BookingActionResponse = {
  success: boolean;
  booking: {
    id: string;
    name: string;
    status: BookingStatus;
  };
};

export type PartialCheckinResponse = {
  success: boolean;
  checkedInCount: number;
  remainingCount: number;
  isComplete: boolean;
  booking: {
    id: string;
    name: string;
    status: BookingStatus;
  };
};

// ── Audit Types ────────────────────────────────────────

export type AuditStatus = "PENDING" | "ACTIVE" | "COMPLETED" | "CANCELLED";
export type AuditAssetStatus = "PENDING" | "FOUND" | "MISSING" | "UNEXPECTED";

export type AuditListItem = {
  id: string;
  name: string;
  description: string | null;
  status: AuditStatus;
  expectedAssetCount: number;
  foundAssetCount: number;
  missingAssetCount: number;
  unexpectedAssetCount: number;
  dueDate: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  createdBy: { firstName: string | null; lastName: string | null };
  assigneeCount: number;
};

export type AuditsResponse = {
  audits: AuditListItem[];
  page: number;
  perPage: number;
  totalCount: number;
  totalPages: number;
};

export type AuditExpectedAsset = {
  id: string;
  name: string;
  auditAssetId: string;
  mainImage: string | null;
  thumbnailImage: string | null;
};

export type AuditScanData = {
  code: string;
  assetId: string;
  assetTitle: string;
  isExpected: boolean;
  scannedAt: string;
  auditAssetId: string | null;
};

export type AuditDetailResponse = {
  audit: {
    id: string;
    name: string;
    description: string | null;
    status: AuditStatus;
    expectedAssetCount: number;
    foundAssetCount: number;
    missingAssetCount: number;
    unexpectedAssetCount: number;
    dueDate: string | null;
    startedAt: string | null;
    completedAt: string | null;
    createdAt: string;
    createdBy: {
      firstName: string | null;
      lastName: string | null;
      profilePicture: string | null;
    };
    assignments: {
      userId: string;
      firstName: string | null;
      lastName: string | null;
      profilePicture: string | null;
      role: string | null;
    }[];
  };
  expectedAssets: AuditExpectedAsset[];
  existingScans: AuditScanData[];
  canScan: boolean;
  canComplete: boolean;
};

export type RecordScanResponse = {
  success: boolean;
  scanId: string;
  auditAssetId: string | null;
  foundAssetCount: number;
  unexpectedAssetCount: number;
};

export type CompleteAuditResponse = {
  success: boolean;
};

export type DashboardAudit = {
  id: string;
  name: string;
  status: AuditStatus;
  expectedAssetCount: number;
  foundAssetCount: number;
  dueDate: string | null;
};

export type Category = {
  id: string;
  name: string;
  color: string;
  assetCount: number;
};

export type CategoriesResponse = {
  categories: Category[];
};

export type CreateAssetResponse = {
  asset: {
    id: string;
    title: string;
  };
};

export type UpdateAssetPayload = {
  assetId: string;
  title?: string;
  description?: string;
  categoryId?: string;
  newLocationId?: string;
  currentLocationId?: string;
  valuation?: number | null;
  customFields?: { id: string; value: any }[];
};

export type UpdateAssetResponse = {
  asset: {
    id: string;
    title: string;
    description: string | null;
  };
};

export type DeleteAssetResponse = {
  success: boolean;
};

export type DashboardKPIs = {
  totalAssets: number;
  categories: number;
  locations: number;
  teamMembers: number;
  myCustody: number;
};

export type DashboardBooking = {
  id: string;
  name: string;
  status: BookingStatus;
  from: string;
  to: string;
  custodianName: string | null;
  assetCount: number;
};

export type DashboardAsset = {
  id: string;
  title: string;
  status: string;
  mainImage: string | null;
  category: { id: string; name: string; color: string } | null;
  createdAt: string;
};

export type DashboardResponse = {
  kpis: DashboardKPIs;
  assetsByStatus: Record<string, number>;
  newestAssets: DashboardAsset[];
  upcomingBookings: DashboardBooking[];
  activeBookings: DashboardBooking[];
  overdueBookings: DashboardBooking[];
  activeAudits: DashboardAudit[];
};

// ── API Functions ──────────────────────────────────────

export const api = {
  /** Get current user profile and organizations */
  me: () => apiFetch<MeResponse>("/api/mobile/me"),

  /** Get dashboard data (KPIs, bookings, newest assets) */
  dashboard: (orgId: string) =>
    apiFetch<DashboardResponse>(`/api/mobile/dashboard?orgId=${orgId}`),

  /** Get paginated assets for an organization */
  assets: (
    orgId: string,
    params?: {
      search?: string;
      page?: number;
      perPage?: number;
      myCustody?: boolean;
      status?: string;
    }
  ) => {
    const searchParams = new URLSearchParams({ orgId });
    if (params?.search) searchParams.set("search", params.search);
    if (params?.page) searchParams.set("page", String(params.page));
    if (params?.perPage) searchParams.set("perPage", String(params.perPage));
    if (params?.myCustody) searchParams.set("myCustody", "true");
    if (params?.status) searchParams.set("status", params.status);
    return apiFetch<AssetsResponse>(`/api/mobile/assets?${searchParams}`);
  },

  /** Get full asset details */
  asset: (assetId: string) =>
    apiFetch<{ asset: AssetDetail }>(`/api/mobile/assets/${assetId}`),

  /** Resolve a QR code to an asset */
  qr: (qrId: string) => apiFetch<QrResponse>(`/api/mobile/qr/${qrId}`),

  /** Resolve a barcode (additional code) to an asset */
  barcode: (value: string, orgId: string) =>
    apiFetch<BarcodeResponse>(
      `/api/mobile/barcode/${encodeURIComponent(value)}?orgId=${orgId}`
    ),

  /** Get team members for an organization (for custody picker) */
  teamMembers: (orgId: string, search?: string) => {
    const searchParams = new URLSearchParams({ orgId });
    if (search) searchParams.set("search", search);
    const path = `/api/mobile/team-members?${searchParams}`;
    // Only cache non-search requests (full list)
    return search
      ? apiFetch<TeamMembersResponse>(path)
      : cachedApiFetch<TeamMembersResponse>(path);
  },

  /** Get locations for an organization (for location picker) */
  locations: (orgId: string, search?: string) => {
    const searchParams = new URLSearchParams({ orgId });
    if (search) searchParams.set("search", search);
    const path = `/api/mobile/locations?${searchParams}`;
    // Only cache non-search requests (full list)
    return search
      ? apiFetch<LocationsResponse>(path)
      : cachedApiFetch<LocationsResponse>(path);
  },

  /** Assign custody of an asset to a team member */
  assignCustody: async (
    orgId: string,
    assetId: string,
    custodianId: string
  ) => {
    const result = await apiFetch<CustodyResponse>(
      `/api/mobile/custody/assign?orgId=${orgId}`,
      {
        method: "POST",
        body: JSON.stringify({ assetId, custodianId }),
      }
    );
    if (!result.error) invalidateResponseCache("/api/mobile/team-members");
    return result;
  },

  /** Release custody of an asset (check in) */
  releaseCustody: async (orgId: string, assetId: string) => {
    const result = await apiFetch<CustodyResponse>(
      `/api/mobile/custody/release?orgId=${orgId}`,
      {
        method: "POST",
        body: JSON.stringify({ assetId }),
      }
    );
    if (!result.error) invalidateResponseCache("/api/mobile/team-members");
    return result;
  },

  /** Update asset location */
  updateLocation: async (
    orgId: string,
    assetId: string,
    locationId: string
  ) => {
    const result = await apiFetch<UpdateLocationResponse>(
      `/api/mobile/asset/update-location?orgId=${orgId}`,
      {
        method: "POST",
        body: JSON.stringify({ assetId, locationId }),
      }
    );
    if (!result.error) invalidateResponseCache("/api/mobile/locations");
    return result;
  },

  /** Add a comment note to an asset */
  addNote: (assetId: string, content: string) =>
    apiFetch<{ note: AssetNote }>("/api/mobile/asset/add-note", {
      method: "POST",
      body: JSON.stringify({ assetId, content }),
    }),

  /** Bulk assign custody of multiple assets to a team member */
  bulkAssignCustody: (orgId: string, assetIds: string[], custodianId: string) =>
    apiFetch<BulkActionResponse>(
      `/api/mobile/bulk-assign-custody?orgId=${orgId}`,
      {
        method: "POST",
        body: JSON.stringify({ assetIds, custodianId }),
      }
    ),

  /** Bulk release custody of multiple assets */
  bulkReleaseCustody: (orgId: string, assetIds: string[]) =>
    apiFetch<BulkActionResponse>(
      `/api/mobile/bulk-release-custody?orgId=${orgId}`,
      {
        method: "POST",
        body: JSON.stringify({ assetIds }),
      }
    ),

  /** Bulk update location of multiple assets */
  bulkUpdateLocation: (orgId: string, assetIds: string[], locationId: string) =>
    apiFetch<BulkActionResponse>(
      `/api/mobile/bulk-update-location?orgId=${orgId}`,
      {
        method: "POST",
        body: JSON.stringify({ assetIds, locationId }),
      }
    ),

  // ── Bookings ────────────────────────────────────────

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

  /** Check out a booking (RESERVED → ONGOING) */
  checkoutBooking: (orgId: string, bookingId: string, timeZone?: string) =>
    apiFetch<BookingActionResponse>(
      `/api/mobile/bookings/checkout?orgId=${orgId}`,
      {
        method: "POST",
        body: JSON.stringify({ bookingId, timeZone }),
      }
    ),

  /** Full check-in (ONGOING → COMPLETE) */
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

  // ── Asset Creation & Editing ───────────────────────

  /** Get categories for an organization (for asset creation picker) */
  categories: (orgId: string) =>
    cachedApiFetch<CategoriesResponse>(`/api/mobile/categories?orgId=${orgId}`),

  /** Create a new asset (quick creation — title required, rest optional) */
  createAsset: (
    orgId: string,
    payload: {
      title: string;
      description?: string;
      categoryId?: string;
      locationId?: string;
      valuation?: number;
    }
  ) =>
    apiFetch<CreateAssetResponse>(`/api/mobile/asset/create?orgId=${orgId}`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  /** Update an existing asset (partial update — only provided fields change) */
  updateAsset: (orgId: string, payload: UpdateAssetPayload) =>
    apiFetch<UpdateAssetResponse>(`/api/mobile/asset/update?orgId=${orgId}`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  /** Delete an asset */
  deleteAsset: (orgId: string, assetId: string) =>
    apiFetch<DeleteAssetResponse>(`/api/mobile/asset/delete?orgId=${orgId}`, {
      method: "POST",
      body: JSON.stringify({ assetId }),
    }),

  /** Update asset image (multipart upload) */
  updateImage: (
    orgId: string,
    assetId: string,
    imageUri: string,
    mimeType: string = "image/jpeg"
  ) => {
    const formData = new FormData();
    // React Native FormData accepts objects with uri/type/name for file uploads
    formData.append("mainImage", {
      uri: imageUri,
      type: mimeType,
      name: `photo.${mimeType === "image/png" ? "png" : "jpg"}`,
    } as any);

    return apiUpload<UpdateImageResponse>(
      `/api/mobile/asset/update-image?orgId=${orgId}&assetId=${assetId}`,
      formData
    );
  },

  // ── Audits ──────────────────────────────────────────

  /** Get paginated audits for an organization */
  audits: (
    orgId: string,
    params?: {
      status?: string;
      page?: number;
      perPage?: number;
      search?: string;
    }
  ) => {
    const searchParams = new URLSearchParams({ orgId });
    if (params?.status) searchParams.set("status", params.status);
    if (params?.page) searchParams.set("page", String(params.page));
    if (params?.perPage) searchParams.set("perPage", String(params.perPage));
    if (params?.search) searchParams.set("search", params.search);
    return apiFetch<AuditsResponse>(`/api/mobile/audits?${searchParams}`);
  },

  /** Get full audit detail with expected assets and existing scans */
  audit: (auditId: string, orgId: string) =>
    apiFetch<AuditDetailResponse>(
      `/api/mobile/audits/${auditId}?orgId=${orgId}`
    ),

  /** Record a scan during an audit (idempotent) */
  recordAuditScan: (
    orgId: string,
    payload: {
      auditSessionId: string;
      qrId: string;
      assetId: string;
      isExpected: boolean;
    }
  ) =>
    apiFetch<RecordScanResponse>(
      `/api/mobile/audits/record-scan?orgId=${orgId}`,
      {
        method: "POST",
        body: JSON.stringify(payload),
      }
    ),

  /** Complete an audit session */
  completeAudit: (
    orgId: string,
    payload: {
      sessionId: string;
      completionNote?: string;
      timeZone?: string;
    }
  ) =>
    apiFetch<CompleteAuditResponse>(
      `/api/mobile/audits/complete?orgId=${orgId}`,
      {
        method: "POST",
        body: JSON.stringify(payload),
      }
    ),
};
