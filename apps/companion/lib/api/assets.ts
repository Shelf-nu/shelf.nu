import { apiFetch } from "./client";
import { cachedApiFetch } from "./cache";
import type {
  AssetsResponse,
  AssetDetail,
  AssetNote,
  QrResponse,
  BarcodeResponse,
  TeamMembersResponse,
  LocationsResponse,
} from "./types";

export const assetsApi = {
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

  /**
   * Get full details for a single asset. The mobile asset-detail route
   * requires `orgId` to scope the lookup to the caller's workspace —
   * passing it as a query param is the standard pattern across the mobile
   * API (matches `assets`, `barcode`, `teamMembers`, etc.).
   *
   * @param assetId - Identifier of the asset to fetch.
   * @param orgId - Caller's current workspace id. Required by the server;
   *   client callers should not invoke this when the value isn't available.
   * @returns `{ asset }` on success or `{ error }` on failure (per
   *   `apiFetch`'s envelope).
   */
  asset: (assetId: string, orgId: string) =>
    apiFetch<{ asset: AssetDetail }>(
      `/api/mobile/assets/${assetId}?orgId=${orgId}`
    ),

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

  /**
   * Post a user-authored comment note to an asset's activity log. The
   * mobile add-note route requires `orgId` to scope the action to the
   * caller's workspace — passing it as a query param matches the rest of
   * the org-scoped mobile API surface (`asset`, `assets`, `barcode`,
   * etc.).
   *
   * @param assetId - Identifier of the asset to attach the note to.
   * @param content - Trimmed note body. Caller should validate non-empty
   *   before invoking; the server will reject empty content but the
   *   round-trip is wasteful.
   * @param orgId - Caller's current workspace id. Required by the server;
   *   client callers should not invoke this when the value isn't available
   *   (the asset-detail screen disables the Post button until it is).
   * @returns `{ note }` on success or `{ error }` on failure (per
   *   `apiFetch`'s envelope).
   */
  addNote: (assetId: string, content: string, orgId: string) =>
    apiFetch<{ note: AssetNote }>(`/api/mobile/asset/add-note?orgId=${orgId}`, {
      method: "POST",
      body: JSON.stringify({ assetId, content }),
    }),
};
