/**
 * Asset mutation API helpers.
 *
 * Thin wrappers around `apiFetch` / `apiUpload` for the create / update /
 * delete / image-upload endpoints, plus the supporting picker endpoints
 * (`categories`, `customFields`). All helpers return the structured
 * `{ data, error }` envelope from `apiFetch` — they never throw.
 *
 * @see {@link file://./client.ts} for the underlying transport and how
 *   `options.signal` is plumbed through for cancellation.
 */

import { apiFetch, apiUpload } from "./client";
import { cachedApiFetch } from "./cache";
import type {
  CategoriesResponse,
  CreateAssetResponse,
  CustomFieldsResponse,
  CustomFieldValue,
  UpdateAssetPayload,
  UpdateAssetResponse,
  DeleteAssetResponse,
  UpdateImageResponse,
} from "./types";

export const assetMutationsApi = {
  /** Get categories for an organization (for asset creation picker) */
  categories: (orgId: string) =>
    cachedApiFetch<CategoriesResponse>(`/api/mobile/categories?orgId=${orgId}`),

  /**
   * Get the active custom field definitions for the org, optionally filtered
   * to those that apply to `categoryId`. Used by the create / edit screens
   * to render the right inputs (including required indicators) for the
   * currently selected category. Pass `categoryId = undefined` (or omit) to
   * get the fields that apply to assets with no category.
   *
   * @param signal Optional `AbortSignal`. When the caller's effect cleans up
   *   (e.g. the user changes the category before the previous request
   *   completes), aborting prevents a stale response from clobbering the
   *   newer one. Forwarded to `apiFetch` which already chains it onto its
   *   internal timeout controller.
   */
  customFields: (orgId: string, categoryId?: string, signal?: AbortSignal) => {
    const params = new URLSearchParams({ orgId });
    if (categoryId) params.set("categoryId", categoryId);
    return apiFetch<CustomFieldsResponse>(
      `/api/mobile/custom-fields?${params}`,
      { signal }
    );
  },

  /**
   * Create a new asset. Title is required; description / category / location
   * / valuation are optional. If the chosen category has any custom fields
   * with `required: true`, every required field MUST be present in the
   * `customFields` payload — otherwise the server returns 400 with the
   * missing field names. Mirrors the webapp create form contract.
   */
  createAsset: (
    orgId: string,
    payload: {
      title: string;
      description?: string;
      categoryId?: string;
      locationId?: string;
      valuation?: number;
      customFields?: { id: string; value: CustomFieldValue }[];
    }
  ) =>
    apiFetch<CreateAssetResponse>(`/api/mobile/asset/create?orgId=${orgId}`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  /** Update an existing asset (partial update -- only provided fields change) */
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
};
