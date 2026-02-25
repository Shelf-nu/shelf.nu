import { ShelfError, makeShelfError } from "~/utils/error";
import type { DataResponse } from "~/utils/http.server";

type ScannedItemResponse = DataResponse<{
  qr?: {
    asset?: {
      id: string;
    };
  };
}>;

export type ResolveAssetIdFromSamIdOptions = {
  samId: string;
  fetcher?: typeof fetch;
};

const DEFAULT_SAM_ID_ERROR_MESSAGE =
  "This SAM ID doesn't exist or it doesn't belong to your current organization.";
const DEFAULT_SAM_ID_ERROR_TITLE = "SAM ID not found";

export async function resolveAssetIdFromSamId({
  samId,
  fetcher = fetch,
}: ResolveAssetIdFromSamIdOptions): Promise<string> {
  const url = `/api/get-scanned-item/${encodeURIComponent(samId)}`;

  let response: Response;

  try {
    response = await fetcher(url);
  } catch (cause) {
    throw new ShelfError({
      cause,
      label: "Scan",
      message:
        "We couldn't reach the server to look up that SAM ID. Check your connection and try again.",
      title: "SAM ID lookup failed",
      shouldBeCaptured: false,
      additionalData: { samId, shouldSendNotification: false },
    });
  }

  let payload: ScannedItemResponse | undefined;

  try {
    payload = (await response.json()) as ScannedItemResponse;
  } catch (cause) {
    throw new ShelfError({
      cause,
      label: "Scan",
      message:
        "We couldn't process the response from the SAM ID lookup. Please try again.",
      title: "SAM ID lookup failed",
      shouldBeCaptured: false,
      additionalData: { samId, shouldSendNotification: false },
    });
  }

  if (!response.ok) {
    const reason = makeShelfError(
      payload?.error ?? {
        cause: null,
        label: "Scan" as const,
        message: DEFAULT_SAM_ID_ERROR_MESSAGE,
        title: DEFAULT_SAM_ID_ERROR_TITLE,
        shouldBeCaptured: false,
        status: (response.status as 400 | 404 | 500 | undefined) ?? 404,
        additionalData: { shouldSendNotification: false },
      },
      { samId, shouldSendNotification: false },
      false
    );

    throw reason;
  }

  const assetId = payload?.qr?.asset?.id;

  if (!assetId) {
    throw new ShelfError({
      cause: null,
      label: "Scan",
      message: DEFAULT_SAM_ID_ERROR_MESSAGE,
      title: DEFAULT_SAM_ID_ERROR_TITLE,
      shouldBeCaptured: false,
      additionalData: { samId, shouldSendNotification: false },
      status: 404,
    });
  }

  return assetId;
}
