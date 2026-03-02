import { describe, expect, it, vitest, beforeEach } from "vitest";
import { db } from "~/database/db.server";
import { getSupabaseAdmin } from "~/integrations/supabase/client";
import { getQr } from "~/modules/qr/service.server";
import { ShelfError } from "~/utils/error";
import { createSignedUrl } from "~/utils/storage.server";
import {
  relinkAssetQrCode,
  uploadDuplicateAssetMainImage,
} from "./service.server";

// why: isolating asset service logic from actual database operations
vitest.mock("~/database/db.server", () => ({
  db: {
    asset: {
      findFirst: vitest.fn().mockResolvedValue(null),
      update: vitest.fn().mockResolvedValue({}),
    },
    qr: {
      update: vitest.fn().mockResolvedValue({}),
    },
  },
}));

// why: avoid real QR lookup during relink tests
vitest.mock("~/modules/qr/service.server", () => ({
  getQr: vitest.fn(),
}));

// why: avoid hitting Supabase storage during uploadDuplicateAssetMainImage tests
vitest.mock("~/integrations/supabase/client", () => ({
  getSupabaseAdmin: vitest.fn(),
}));

// why: avoid generating signed URLs during uploadDuplicateAssetMainImage tests
vitest.mock("~/utils/storage.server", async () => {
  const actual = await vitest.importActual<Record<string, unknown>>(
    "~/utils/storage.server"
  );
  return {
    ...actual,
    createSignedUrl: vitest.fn(),
  };
});

// why: avoid user lookup side effects during relink tests
vitest.mock("~/modules/user/service.server", () => ({
  getUserByID: vitest.fn().mockResolvedValue({
    id: "user-1",
    firstName: "John",
    lastName: "Doe",
  }),
}));

// why: avoid creating actual notes during relink tests
vitest.mock("~/modules/note/service.server", () => ({
  createNote: vitest.fn().mockResolvedValue({}),
}));

describe("relinkAssetQrCode (asset)", () => {
  beforeEach(() => {
    vitest.clearAllMocks();
  });

  it("throws when QR is already linked to a kit", async () => {
    //@ts-expect-error mock setup
    getQr.mockResolvedValue({
      id: "qr-1",
      organizationId: "org-1",
      assetId: null,
      kitId: "kit-1",
    });
    //@ts-expect-error mock setup
    db.asset.findFirst.mockResolvedValue({ qrCodes: [] });

    await expect(
      relinkAssetQrCode({
        qrId: "qr-1",
        assetId: "asset-1",
        organizationId: "org-1",
        userId: "user-1",
      })
    ).rejects.toBeInstanceOf(ShelfError);
  });

  it("relinks when QR is available", async () => {
    //@ts-expect-error mock setup
    getQr.mockResolvedValue({
      id: "qr-1",
      organizationId: "org-1",
      assetId: null,
      kitId: null,
    });
    //@ts-expect-error mock setup
    db.asset.findFirst.mockResolvedValue({ qrCodes: [{ id: "old-qr" }] });

    await relinkAssetQrCode({
      qrId: "qr-1",
      assetId: "asset-1",
      organizationId: "org-1",
      userId: "user-1",
    });

    expect(db.qr.update).toHaveBeenCalledWith({
      where: { id: "qr-1" },
      data: { organizationId: "org-1", userId: "user-1" },
    });
    expect(db.asset.update).toHaveBeenCalledWith({
      where: { id: "asset-1", organizationId: "org-1" },
      data: {
        qrCodes: {
          set: [],
          connect: { id: "qr-1" },
        },
      },
    });
  });
});

describe("uploadDuplicateAssetMainImage", () => {
  beforeEach(() => {
    vitest.clearAllMocks();
  });

  it("uploads a valid image buffer and returns a signed URL", async () => {
    const pngHeader = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ]);
    const arrayBuffer = pngHeader.buffer.slice(
      pngHeader.byteOffset,
      pngHeader.byteOffset + pngHeader.byteLength
    );

    const download = vitest.fn().mockResolvedValue({
      data: {
        arrayBuffer: () => arrayBuffer,
      },
      error: null,
    });
    const upload = vitest.fn().mockResolvedValue({
      data: { path: "user-1/asset-1/main-image-123" },
      error: null,
    });
    const list = vitest.fn().mockResolvedValue({
      data: [{ name: "main-image-123" }, { name: "main-image-122" }],
      error: null,
    });
    const remove = vitest.fn().mockResolvedValue({ data: null, error: null });

    // @ts-expect-error mock setup
    getSupabaseAdmin.mockReturnValue({
      storage: {
        from: () => ({
          download,
          upload,
          list,
          remove,
        }),
      },
    });
    // @ts-expect-error mock setup
    createSignedUrl.mockResolvedValue("signed-url");

    const result = await uploadDuplicateAssetMainImage(
      "https://example.supabase.co/storage/v1/object/sign/assets/user-1/asset-1/main-image-123?token=abc",
      "asset-1",
      "user-1"
    );

    expect(result).toBe("signed-url");
    expect(download).toHaveBeenCalledWith("user-1/asset-1/main-image-123");
    expect(upload).toHaveBeenCalledWith(
      expect.stringContaining("user-1/asset-1/main-image-"),
      expect.any(Buffer),
      { contentType: "image/png", upsert: true }
    );
    expect(createSignedUrl).toHaveBeenCalledWith({
      filename: "user-1/asset-1/main-image-123",
    });
    expect(list).toHaveBeenCalled();
    expect(remove).toHaveBeenCalled();
  });

  it("rejects when the downloaded buffer is not a supported image", async () => {
    const jsonPayload = Buffer.from(
      JSON.stringify({
        statusCode: "400",
        error: "InvalidJWT",
        message: '"exp" claim timestamp check failed',
      })
    );
    const arrayBuffer = jsonPayload.buffer.slice(
      jsonPayload.byteOffset,
      jsonPayload.byteOffset + jsonPayload.byteLength
    );

    const download = vitest.fn().mockResolvedValue({
      data: {
        arrayBuffer: () => arrayBuffer,
      },
      error: null,
    });
    const upload = vitest.fn();

    // @ts-expect-error mock setup
    getSupabaseAdmin.mockReturnValue({
      storage: {
        from: () => ({
          download,
          upload,
          list: vitest.fn(),
          remove: vitest.fn(),
        }),
      },
    });

    await expect(
      uploadDuplicateAssetMainImage(
        "https://example.supabase.co/storage/v1/object/sign/assets/user-1/asset-1/main-image-123?token=abc",
        "asset-1",
        "user-1"
      )
    ).rejects.toBeInstanceOf(ShelfError);

    expect(upload).not.toHaveBeenCalled();
  });
});
