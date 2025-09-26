import { describe, expect, it, vi } from "vitest";

import { resolveAssetIdFromSamId } from "~/routes/_layout+/scanner-sam-id";

const SUCCESS_RESPONSE = {
  error: null,
  qr: { asset: { id: "asset-123" } },
};

describe("resolveAssetIdFromSamId", () => {
  it("returns the asset id when the lookup succeeds", async () => {
    const fetcher = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue(SUCCESS_RESPONSE),
    } as unknown as Response);

    await expect(resolveAssetIdFromSamId({ samId: "SAM-0001", fetcher })).resolves.toBe(
      "asset-123"
    );

    expect(fetcher).toHaveBeenCalledWith("/api/get-scanned-item/SAM-0001");
  });

  it("throws a shelf error when the server returns an error response", async () => {
    const errorPayload = {
      error: {
        cause: null,
        label: "Scan" as const,
        message: "Custom error",
        title: "SAM ID invalid",
        shouldBeCaptured: false,
        status: 404 as const,
      },
    };

    const fetcher = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      json: vi.fn().mockResolvedValue(errorPayload),
    } as unknown as Response);

    await expect(
      resolveAssetIdFromSamId({ samId: "SAM-0002", fetcher })
    ).rejects.toMatchObject({
      message: "Custom error",
      title: "SAM ID invalid",
      label: "Scan",
    });
  });

  it("throws a descriptive error when the response is malformed", async () => {
    const fetcher = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ error: null }),
    } as unknown as Response);

    await expect(
      resolveAssetIdFromSamId({ samId: "SAM-0003", fetcher })
    ).rejects.toMatchObject({
      message:
        "This SAM ID doesn't exist or it doesn't belong to your current organization.",
      title: "SAM ID not found",
    });
  });

  it("throws a descriptive error when the request fails", async () => {
    const fetcher = vi.fn().mockRejectedValue(new Error("network"));

    await expect(
      resolveAssetIdFromSamId({ samId: "SAM-0004", fetcher })
    ).rejects.toMatchObject({
      message:
        "We couldn't reach the server to look up that SAM ID. Check your connection and try again.",
      title: "SAM ID lookup failed",
    });
  });
});
