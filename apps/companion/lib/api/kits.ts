/**
 * Kits API — list, detail, and bulk scanner operations.
 *
 * Talks to the mobile kit routes on the webapp, which wrap the same kit
 * services the web UI uses (custody cascades to contained assets, notes,
 * activity events stay consistent across platforms).
 *
 * @see {@link file://../../../webapp/app/routes/api+/mobile+/kits.ts}
 * @see {@link file://../../../webapp/app/routes/api+/mobile+/kits.$kitId.ts}
 * @see {@link file://../../../webapp/app/routes/api+/mobile+/kits.bulk-actions.ts}
 */
import { apiFetch } from "./client";
import type {
  BulkActionResponse,
  KitDetailResponse,
  KitsResponse,
} from "./types";

/** Optional filters for the kits list */
type KitListParams = {
  search?: string;
  page?: number;
  perPage?: number;
  status?: string;
  /** Only kits in the current user's custody. */
  myCustody?: boolean;
};

export const kitsApi = {
  /** Paginated kit list for the current workspace. */
  kits: (orgId: string, params: KitListParams = {}) => {
    const qs = new URLSearchParams({ orgId });
    if (params.search) qs.set("search", params.search);
    if (params.page) qs.set("page", String(params.page));
    if (params.perPage) qs.set("perPage", String(params.perPage));
    if (params.status) qs.set("status", params.status);
    if (params.myCustody) qs.set("myCustody", "true");
    return apiFetch<KitsResponse>(`/api/mobile/kits?${qs.toString()}`);
  },

  /** Full kit detail including contained assets. */
  kit: (kitId: string, orgId: string) =>
    apiFetch<KitDetailResponse>(
      `/api/mobile/kits/${encodeURIComponent(kitId)}?orgId=${orgId}`
    ),

  /** Assign custody of the given kits (cascades to contained assets). */
  bulkAssignKitCustody: (
    orgId: string,
    kitIds: string[],
    custodianId: string
  ) =>
    apiFetch<BulkActionResponse>(
      `/api/mobile/kits/bulk-actions?orgId=${orgId}`,
      {
        method: "POST",
        body: JSON.stringify({ intent: "assign-custody", kitIds, custodianId }),
      }
    ),

  /** Release custody of the given kits. */
  bulkReleaseKitCustody: (orgId: string, kitIds: string[]) =>
    apiFetch<BulkActionResponse>(
      `/api/mobile/kits/bulk-actions?orgId=${orgId}`,
      {
        method: "POST",
        body: JSON.stringify({ intent: "release-custody", kitIds }),
      }
    ),

  /** Move the given kits (and their assets) to a new location. */
  bulkUpdateKitLocation: (
    orgId: string,
    kitIds: string[],
    newLocationId: string
  ) =>
    apiFetch<BulkActionResponse>(
      `/api/mobile/kits/bulk-actions?orgId=${orgId}`,
      {
        method: "POST",
        body: JSON.stringify({
          intent: "update-location",
          kitIds,
          newLocationId,
        }),
      }
    ),
};
