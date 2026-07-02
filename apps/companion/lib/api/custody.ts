import { apiFetch } from "./client";
import { invalidateResponseCache } from "./cache";
import type {
  CustodyResponse,
  QuantityCustodyResponse,
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

  /**
   * Assign N units of a QUANTITY_TRACKED asset to a team member.
   * Mobile twin of the web's /api/assets/assign-quantity-custody — the
   * server validates availability, org scope, and the self-service guard.
   */
  assignQuantityCustody: async (
    orgId: string,
    assetId: string,
    teamMemberId: string,
    quantity: number,
    note?: string
  ) => {
    const result = await apiFetch<QuantityCustodyResponse>(
      `/api/mobile/custody/assign-quantity?orgId=${orgId}`,
      {
        method: "POST",
        body: JSON.stringify({ assetId, teamMemberId, quantity, note }),
        // why: non-idempotent — a timed-out-but-landed request must not be
        // auto-retried, or the assignment double-applies.
        retry: false,
      }
    );
    if (!result.error) invalidateResponseCache("/api/mobile/team-members");
    return result;
  },

  /**
   * Release N units of a QUANTITY_TRACKED asset from a team member's custody.
   * Mobile twin of the web's /api/assets/release-quantity-custody — only
   * operator-assigned units are releasable (kit-allocated units are cleared
   * by releasing the kit's custody); the server enforces the held cap.
   */
  releaseQuantityCustody: async (
    orgId: string,
    assetId: string,
    teamMemberId: string,
    quantity: number,
    note?: string
  ) => {
    const result = await apiFetch<QuantityCustodyResponse>(
      `/api/mobile/custody/release-quantity?orgId=${orgId}`,
      {
        method: "POST",
        body: JSON.stringify({ assetId, teamMemberId, quantity, note }),
        // why: non-idempotent — a timed-out-but-landed request must not be
        // auto-retried, or the release double-applies.
        retry: false,
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
