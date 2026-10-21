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
    note?: string,
    /**
     * Where the units come from: a location id, or `null` for the unplaced
     * units. Sent only for a pool placed at two or more locations; left out,
     * the server records its own default (the pool's one location, or no
     * source).
     */
    locationId?: string | null
  ) => {
    const result = await apiFetch<QuantityCustodyResponse>(
      `/api/mobile/custody/assign-quantity?orgId=${orgId}`,
      {
        method: "POST",
        body: JSON.stringify({
          assetId,
          teamMemberId,
          quantity,
          note,
          ...(locationId !== undefined ? { locationId } : {}),
        }),
        // why: non-idempotent — a timed-out-but-landed request must not be
        // auto-retried, or the assignment double-applies.
        retry: false,
      }
    );
    if (!result.error) invalidateResponseCache("/api/mobile/team-members");
    return result;
  },

  /**
   * End a team member's hold on N units of a QUANTITY_TRACKED asset. Mobile
   * twin of the web's /api/assets/release-quantity-custody — only
   * operator-assigned units are releasable (kit-allocated units are cleared
   * by releasing the kit's custody); the server enforces the held cap.
   *
   * `options.consumed` records how many of the released units were used up.
   * Omit it and the server derives the outcome from the asset's
   * consumptionType, so an older build still behaves correctly.
   */
  releaseQuantityCustody: async (
    orgId: string,
    assetId: string,
    teamMemberId: string,
    quantity: number,
    options?: {
      consumed?: number;
      note?: string;
      /**
       * Release only the units taken from this source: a location id, `null`
       * for the unplaced units, or `"unrecorded"` for units whose source was
       * never recorded. Left out, the server draws the holder's rows in its
       * fixed order.
       */
      locationId?: string | null;
    }
  ) => {
    const result = await apiFetch<QuantityCustodyResponse>(
      `/api/mobile/custody/release-quantity?orgId=${orgId}`,
      {
        method: "POST",
        body: JSON.stringify({
          assetId,
          teamMemberId,
          quantity,
          consumed: options?.consumed,
          note: options?.note,
          ...(options?.locationId !== undefined
            ? { locationId: options.locationId }
            : {}),
        }),
        // why: non-idempotent — a timed-out-but-landed request must not be
        // auto-retried, or the release double-applies.
        retry: false,
      }
    );
    if (!result.error) invalidateResponseCache("/api/mobile/team-members");
    return result;
  },

  /**
   * Update asset location. `quantity` is the per-placement amount for a
   * QUANTITY_TRACKED asset (units to place at the location — the remainder
   * stays in the unplaced pool); omit it to place the full pool. INDIVIDUAL
   * assets ignore it. The server treats the write as a pivot replace, so any
   * multi-placement collapses to the single new row.
   */
  updateLocation: async (
    orgId: string,
    assetId: string,
    locationId: string,
    quantity?: number
  ) => {
    const result = await apiFetch<UpdateLocationResponse>(
      `/api/mobile/asset/update-location?orgId=${orgId}`,
      {
        method: "POST",
        body: JSON.stringify({
          assetId,
          locationId,
          ...(quantity != null ? { quantity } : {}),
        }),
      }
    );
    if (!result.error) invalidateResponseCache("/api/mobile/locations");
    return result;
  },

  /**
   * Bulk assign custody of multiple assets to a team member.
   *
   * `quantities` gives units per QUANTITY_TRACKED asset id in `assetIds`; the
   * server assigns those unit by unit and the rest whole, checking every unit
   * count before it writes anything. Omitted when empty, so a scan without
   * quantity rows sends the same body as before.
   */
  bulkAssignCustody: (
    orgId: string,
    assetIds: string[],
    custodianId: string,
    quantities: Record<string, number> = {}
  ) =>
    apiFetch<BulkActionResponse>(
      `/api/mobile/bulk-assign-custody?orgId=${orgId}`,
      {
        method: "POST",
        body: JSON.stringify({
          assetIds,
          custodianId,
          ...(Object.keys(quantities).length > 0 ? { quantities } : {}),
        }),
        // why: units make it non-idempotent: a timed-out-but-landed request
        // must not be auto-retried, or the units are assigned twice.
        retry: Object.keys(quantities).length === 0,
      }
    ),

  /**
   * Bulk release custody of multiple assets.
   *
   * `quantities` gives units per QUANTITY_TRACKED asset id in `assetIds`; the
   * server releases those from each asset's single holder and the rest whole.
   * Omitted when empty, so a scan without quantity rows sends the same body
   * as before.
   */
  bulkReleaseCustody: (
    orgId: string,
    assetIds: string[],
    quantities: Record<string, number> = {}
  ) =>
    apiFetch<BulkActionResponse>(
      `/api/mobile/bulk-release-custody?orgId=${orgId}`,
      {
        method: "POST",
        body: JSON.stringify({
          assetIds,
          ...(Object.keys(quantities).length > 0 ? { quantities } : {}),
        }),
        // why: units make it non-idempotent: a timed-out-but-landed request
        // must not be auto-retried, or the units are released twice.
        retry: Object.keys(quantities).length === 0,
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
