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

  /** Get full asset details */
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

  /** Add a comment note to an asset */
  addNote: (assetId: string, content: string) =>
    apiFetch<{ note: AssetNote }>("/api/mobile/asset/add-note", {
      method: "POST",
      body: JSON.stringify({ assetId, content }),
    }),
};
