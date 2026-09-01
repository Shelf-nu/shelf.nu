import { beforeEach, describe, expect, it, vi } from "vitest";

// why: isolate the attachment service functions from real storage/db calls,
// mirroring modules/audit/image.service.server.test.ts's local-mock style
// rather than the shared mock in this module's own service.server.test.ts.
vi.mock("~/utils/storage.server", () => ({
  parsePdfFormData: vi.fn(),
  createSignedUrl: vi.fn(
    ({ filename }: { filename: string }) =>
      `https://example.supabase.co/storage/v1/object/sign/assets/${filename}?token=signed`
  ),
  removeFileAtPath: vi.fn(),
  removeFilesByPrefix: vi.fn(),
}));

vi.mock("~/database/db.server", () => ({
  db: {
    asset: {
      findFirstOrThrow: vi.fn(),
      update: vi.fn(),
    },
  },
}));

import { db } from "~/database/db.server";
import {
  createSignedUrl,
  parsePdfFormData,
  removeFileAtPath,
  removeFilesByPrefix,
} from "~/utils/storage.server";
import {
  clearStagedAssetAttachment,
  removeAssetAttachment,
  resolveAssetAttachmentDisplayUrl,
  stageAssetAttachment,
  updateAssetAttachment,
} from "./service.server";

describe("asset attachment", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("updateAssetAttachment", () => {
    it("uploads a new attachment and persists its storage path (not a URL)", async () => {
      vi.mocked(db.asset.findFirstOrThrow).mockResolvedValue({
        id: "asset-1",
        attachmentPath: null,
      } as any);

      vi.mocked(parsePdfFormData).mockResolvedValue({
        path: "org-1/asset-1/attachment-123.pdf",
        originalName: "invoice.pdf",
        size: 1234,
      });
      vi.mocked(db.asset.update).mockResolvedValue({
        id: "asset-1",
        attachmentOriginalName: "invoice.pdf",
      } as any);

      const result = await updateAssetAttachment({
        request: {} as Request,
        assetId: "asset-1",
        organizationId: "org-1",
      });

      // No public URL is ever constructed for the new upload - the raw
      // path from parsePdfFormData is persisted as-is.
      expect(removeFileAtPath).not.toHaveBeenCalled();
      expect(db.asset.update).toHaveBeenCalledWith({
        where: { id: "asset-1", organizationId: "org-1" },
        data: {
          attachmentPath: "org-1/asset-1/attachment-123.pdf",
          attachmentOriginalName: "invoice.pdf",
          attachmentSize: 1234,
        },
      });
      expect(result.attachmentOriginalName).toBe("invoice.pdf");
    });

    it("deletes the previous attachment's exact path when replacing one", async () => {
      vi.mocked(db.asset.findFirstOrThrow).mockResolvedValue({
        id: "asset-1",
        attachmentPath: "org-1/asset-1/attachment-old.pdf",
      } as any);

      vi.mocked(parsePdfFormData).mockResolvedValue({
        path: "org-1/asset-1/attachment-new.pdf",
        originalName: "invoice-2.pdf",
        size: 999,
      });
      vi.mocked(db.asset.update).mockResolvedValue({} as any);

      await updateAssetAttachment({
        request: {} as Request,
        assetId: "asset-1",
        organizationId: "org-1",
      });

      // Deletes ONLY the old file's exact path - a folder-wide delete here
      // would also destroy the new file just uploaded into the same
      // org/asset folder.
      expect(removeFileAtPath).toHaveBeenCalledWith({
        path: "org-1/asset-1/attachment-old.pdf",
        bucketName: "assets",
      });
      expect(removeFilesByPrefix).not.toHaveBeenCalled();
    });

    it("throws and does not touch the db when no file was uploaded", async () => {
      vi.mocked(db.asset.findFirstOrThrow).mockResolvedValue({
        id: "asset-1",
        attachmentPath: null,
      } as any);
      // parsePdfFormData throws when no upload matched the "file" field -
      // it no longer resolves with an empty/absent result, so simulating
      // that means rejecting here rather than resolving with nothing.
      vi.mocked(parsePdfFormData).mockRejectedValue(
        new Error("No file uploaded")
      );

      await expect(
        updateAssetAttachment({
          request: {} as Request,
          assetId: "asset-1",
          organizationId: "org-1",
        })
      ).rejects.toThrow();

      expect(db.asset.update).not.toHaveBeenCalled();
    });

    it("still persists the new attachment when deleting the old file fails", async () => {
      vi.mocked(db.asset.findFirstOrThrow).mockResolvedValue({
        id: "asset-1",
        attachmentPath: "org-1/asset-1/attachment-old.pdf",
      } as any);
      vi.mocked(removeFileAtPath).mockRejectedValue(new Error("gone already"));

      vi.mocked(parsePdfFormData).mockResolvedValue({
        path: "org-1/asset-1/attachment-new.pdf",
        originalName: "invoice-2.pdf",
        size: 999,
      });
      vi.mocked(db.asset.update).mockResolvedValue({} as any);

      await expect(
        updateAssetAttachment({
          request: {} as Request,
          assetId: "asset-1",
          organizationId: "org-1",
        })
      ).resolves.toBeDefined();

      expect(db.asset.update).toHaveBeenCalled();
    });
  });

  describe("removeAssetAttachment", () => {
    it("deletes the file at its exact path and clears the attachment fields", async () => {
      vi.mocked(db.asset.findFirstOrThrow).mockResolvedValue({
        id: "asset-1",
        attachmentPath: "org-1/asset-1/attachment-123.pdf",
      } as any);
      // Explicit, since a previous test in this file leaves removeFileAtPath
      // rejecting - vi.clearAllMocks() (in beforeEach) resets call history
      // but not a configured mockRejectedValue/mockResolvedValue.
      vi.mocked(removeFileAtPath).mockResolvedValue(undefined as any);
      vi.mocked(db.asset.update).mockResolvedValue({} as any);

      await removeAssetAttachment({
        assetId: "asset-1",
        organizationId: "org-1",
      });

      expect(removeFileAtPath).toHaveBeenCalledWith({
        path: "org-1/asset-1/attachment-123.pdf",
        bucketName: "assets",
      });
      expect(db.asset.update).toHaveBeenCalledWith({
        where: { id: "asset-1", organizationId: "org-1" },
        data: {
          attachmentPath: null,
          attachmentOriginalName: null,
          attachmentSize: null,
        },
      });
    });

    it("is a no-op deletion when there is no existing attachment", async () => {
      vi.mocked(db.asset.findFirstOrThrow).mockResolvedValue({
        id: "asset-1",
        attachmentPath: null,
      } as any);
      vi.mocked(db.asset.update).mockResolvedValue({} as any);

      await removeAssetAttachment({
        assetId: "asset-1",
        organizationId: "org-1",
      });

      expect(removeFileAtPath).not.toHaveBeenCalled();
      expect(db.asset.update).toHaveBeenCalled();
    });
  });

  describe("stageAssetAttachment", () => {
    it("uploads to the private bucket and returns both the path and a display URL", async () => {
      vi.mocked(parsePdfFormData).mockResolvedValue({
        path: "org-1/pending-id/attachment-123.pdf",
        originalName: "invoice.pdf",
        size: 1234,
      });

      const result = await stageAssetAttachment({
        request: {} as Request,
        assetId: "pending-id",
        organizationId: "org-1",
      });

      expect(parsePdfFormData).toHaveBeenCalledWith(
        expect.objectContaining({
          newFileName: expect.stringContaining("org-1/pending-id/attachment-"),
        })
      );
      expect(createSignedUrl).toHaveBeenCalledWith({
        filename: "org-1/pending-id/attachment-123.pdf",
        bucketName: "assets",
      });
      // The path (not the signed URL) is what the create form will
      // eventually persist via createAsset(); the signed URL is only for
      // showing the file right now, on this response.
      expect(result.attachmentPath).toBe("org-1/pending-id/attachment-123.pdf");
      expect(result.attachmentDisplayUrl).toContain("token=signed");
      expect(result.attachmentOriginalName).toBe("invoice.pdf");
      expect(result.attachmentSize).toBe(1234);
    });
  });

  describe("clearStagedAssetAttachment", () => {
    it("removes everything under the org/placeholder-id folder in the private bucket", async () => {
      await clearStagedAssetAttachment({
        assetId: "pending-id",
        organizationId: "org-1",
      });

      expect(removeFilesByPrefix).toHaveBeenCalledWith({
        organizationId: "org-1",
        entityId: "pending-id",
        bucketName: "assets",
      });
    });
  });

  describe("resolveAssetAttachmentDisplayUrl", () => {
    it("returns null without calling Supabase when there is no attachment", async () => {
      const result = await resolveAssetAttachmentDisplayUrl({
        attachmentPath: null,
        assetId: "asset-1",
      });

      expect(result).toBeNull();
      expect(createSignedUrl).not.toHaveBeenCalled();
    });

    it("resolves a stored path into a signed URL", async () => {
      const result = await resolveAssetAttachmentDisplayUrl({
        attachmentPath: "org-1/asset-1/attachment-123.pdf",
        assetId: "asset-1",
      });

      expect(createSignedUrl).toHaveBeenCalledWith({
        filename: "org-1/asset-1/attachment-123.pdf",
        bucketName: "assets",
      });
      expect(result).toContain("token=signed");
    });

    it("returns null instead of throwing when signing fails", async () => {
      vi.mocked(createSignedUrl).mockRejectedValue(
        new Error("Supabase is down")
      );

      const result = await resolveAssetAttachmentDisplayUrl({
        attachmentPath: "org-1/asset-1/attachment-123.pdf",
        assetId: "asset-1",
      });

      expect(result).toBeNull();
    });
  });
});
