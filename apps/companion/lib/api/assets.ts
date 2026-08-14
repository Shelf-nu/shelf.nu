import { apiFetch } from "./client";
import { cachedApiFetch } from "./cache";
import type {
  AssetsResponse,
  AssetDetail,
  AssetNote,
  QrResponse,
  QrMutationResponse,
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
   * Wire contract for coordinates (matches the route's Zod schema): optional
   * `latitude`/`longitude` query params, decimal degrees, both or neither
   * (lat −90..90, lng −180..180). They are best-effort provenance — the
   * server silently ignores invalid values and a resolve NEVER fails because
   * of them, mirroring the web flow's non-fatal geolocation post.
   *
   * @param codeId - The scanned QR id or normalized SAM id.
   * @param orgId - Caller's current workspace id; required for SAM lookups.
   * @param coordinates - Optional GPS position captured at scan time (see
   *   `lib/scan-location.ts`); attached to the recorded scan server-side.
   */
  qr: (
    codeId: string,
    orgId?: string,
    coordinates?: { latitude: number; longitude: number } | null
  ) => {
    const searchParams = new URLSearchParams();
    if (orgId) searchParams.set("orgId", orgId);
    const query = searchParams.toString();
    // Coordinates ride as HEADERS, never query params: URLs are captured by
    // access logs and Sentry request breadcrumbs, and precise user GPS must
    // stay out of every URL-shaped capture surface.
    return apiFetch<QrResponse>(
      `/api/mobile/qr/${encodeURIComponent(codeId)}${query ? `?${query}` : ""}`,
      {
        // why: this resolve RECORDS a scan server-side — a timed-out-but-
        // landed request must not be auto-retried, or the same physical
        // scan is recorded twice (same rule as the quantity mutations).
        retry: false,
        ...(coordinates
          ? {
              headers: {
                "X-Scan-Latitude": String(coordinates.latitude),
                "X-Scan-Longitude": String(coordinates.longitude),
              },
            }
          : {}),
      }
    );
  },

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

  /**
   * Claim an unclaimed QR code into the caller's CURRENT organization
   * (`POST /api/mobile/qr/claim`) — the mobile twin of the web claim route.
   * The server claims into the org resolved from `orgId` only; mobile
   * deliberately offers no org picker (web does).
   *
   * Admin/owner only: the server gates on `qr:update`, which no role below
   * ADMIN holds. A 403 also covers the already-claimed race. The server now
   * rethrows its own guard errors instead of re-wrapping them, so that 403
   * carries a specific message ("already belongs to an organization") rather
   * than the old generic "Failed to claim qr code" — but still branch on
   * status, not message text.
   *
   * @param orgId - Caller's current workspace id (the claim target).
   * @param qrId - The unclaimed QR id (echoed by the resolve error payload).
   * @returns `{ qr }` summary on success (assetId/kitId null) or `{ error }`.
   */
  claimQr: (orgId: string, qrId: string) =>
    apiFetch<QrMutationResponse>(`/api/mobile/qr/claim?orgId=${orgId}`, {
      method: "POST",
      body: JSON.stringify({ qrId }),
      // why: not retried — a timed-out-but-landed claim would 403 on the
      // retry ("already claimed"), turning a success into a scary error.
      // The caller's re-resolve fallback recovers the landed case instead.
      retry: false,
    }),

  /**
   * Link a QR code to an existing asset (`POST /api/mobile/qr/link-asset`).
   * Replaces the asset's current QR codes (web parity — the web confirm dialog
   * carries the same warning), so the picker's confirm step must warn about
   * that.
   *
   * The code does NOT need to be claimed first: the route delegates to
   * `relinkAssetQrCode`, which claims an UNCLAIMED code into the caller's org
   * inline as part of the link. There is consequently no
   * `errorDetails.reason === "unclaimed"` response from this endpoint any more
   * — do not write recovery paths against one.
   *
   * Admin/owner only (server gates on `qr:update`, same as the web link flow).
   *
   * @param orgId - Caller's current workspace id (must own the QR, or the
   *   code must be unclaimed — it is then claimed into this org).
   * @param qrId - The QR id to link; claimed by this org, or unclaimed.
   * @param assetId - The asset (in the caller's org) to link the code to.
   * @returns `{ qr }` summary on success (assetId set) or `{ error }`.
   */
  linkQrToAsset: (orgId: string, qrId: string, assetId: string) =>
    apiFetch<QrMutationResponse>(`/api/mobile/qr/link-asset?orgId=${orgId}`, {
      method: "POST",
      body: JSON.stringify({ qrId, assetId }),
      // why: not retried. The 403-on-retry rationale no longer applies —
      // relinking the same {qrId, assetId} is idempotent, since the service
      // only rejects `qr.assetId && qr.assetId !== assetId`. But a retry can
      // still LOSE a concurrent race and 403, and it would write a second
      // "changed QR code" note; the caller's re-resolve fallback is the
      // honest recovery.
      retry: false,
    }),

  /** Resolve a barcode (additional code) to an asset */
  barcode: (value: string, orgId: string) =>
    apiFetch<BarcodeResponse>(
      `/api/mobile/barcode/${encodeURIComponent(value)}?orgId=${orgId}`
    ),

  /** Get team members for an organization (for custody picker) */
  teamMembers: (
    orgId: string,
    search?: string,
    params?: { page?: number; perPage?: number }
  ) => {
    const searchParams = new URLSearchParams({ orgId });
    if (search) searchParams.set("search", search);
    if (params?.page) searchParams.set("page", String(params.page));
    if (params?.perPage) searchParams.set("perPage", String(params.perPage));
    const path = `/api/mobile/team-members?${searchParams}`;
    // Only cache non-search requests (full list)
    return search
      ? apiFetch<TeamMembersResponse>(path)
      : cachedApiFetch<TeamMembersResponse>(path);
  },

  /** Get locations for an organization (for location picker) */
  locations: (
    orgId: string,
    search?: string,
    params?: { page?: number; perPage?: number }
  ) => {
    const searchParams = new URLSearchParams({ orgId });
    if (search) searchParams.set("search", search);
    if (params?.page) searchParams.set("page", String(params.page));
    if (params?.perPage) searchParams.set("perPage", String(params.perPage));
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
