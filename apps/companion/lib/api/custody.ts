import { apiFetch } from "./client";
import { invalidateResponseCache } from "./cache";
import type {
  CustodyResponse,
  UpdateLocationResponse,
  BulkActionResponse,
} from "./types";

export const custodyApi = {
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
};
