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

  /**
   * Resolve a scanned code to an asset or kit, **recording** scan provenance
   * (who + when) for the resolve, mirroring the web's public QR route.
   *
   * Handles both a Shelf QR id and a SAM / sequential id (e.g. `SAM-0001`).
   * A QR id self-identifies its org, but a SAM id is unique only within a
   * workspace, so callers pass `orgId` to scope SAM resolution (the server
   * ignores it on the QR path).
   *
   * Recording is an endpoint property here, NOT a flag: use this from genuine
   * field-scan contexts (scanner tab, deep links). To resolve a code WITHOUT
   * recording (e.g. the audit scanner), use {@link getScannedItem} instead.
   *
   * @param codeId - The scanned QR id or normalized SAM id.
   * @param orgId - Caller's current workspace id; required for SAM lookups.
   */
  qr: (codeId: string, orgId?: string) =>
    apiFetch<QrResponse>(
      `/api/mobile/qr/${encodeURIComponent(codeId)}${
        orgId ? `?orgId=${orgId}` : ""
      }`
    ),

  /**
   * Resolve a scanned code to an asset or kit **without recording** a scan,
   * mirroring the web's non-recording `get-scanned-item` resolve.
   *
   * Same resolution contract as {@link qr} (QR id or SAM id, `orgId` scopes
   * SAM), but it never writes scan provenance. Use this where a resolve is an
   * internal identify step rather than a real field scan, e.g. the audit
   * scanner, which records its own `AuditScan` and must not add an ad-hoc scan
   * to the asset's "last scanned" history.
   *
   * @param codeId - The scanned QR id or normalized SAM id.
   * @param orgId - Caller's current workspace id; required for SAM lookups.
   */
  getScannedItem: (codeId: string, orgId?: string) =>
    apiFetch<QrResponse>(
      `/api/mobile/get-scanned-item/${encodeURIComponent(codeId)}${
        orgId ? `?orgId=${orgId}` : ""
      }`
    ),

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
