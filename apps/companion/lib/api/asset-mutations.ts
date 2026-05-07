import { apiFetch, apiUpload } from "./client";
import { cachedApiFetch } from "./cache";
import type {
  CategoriesResponse,
  CreateAssetResponse,
  UpdateAssetPayload,
  UpdateAssetResponse,
  DeleteAssetResponse,
  UpdateImageResponse,
} from "./types";

export const assetMutationsApi = {
  /** Get categories for an organization (for asset creation picker) */
  categories: (orgId: string) =>
    cachedApiFetch<CategoriesResponse>(`/api/mobile/categories?orgId=${orgId}`),

  /** Create a new asset (quick creation -- title required, rest optional) */
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
