import { beforeEach, describe, expect, it, vi } from "vitest";

// why: isolate the attachment service functions from real storage/db calls,
// mirroring modules/audit/image.service.server.test.ts's local-mock style
// rather than the shared mock in this module's own service.server.test.ts.
vi.mock("~/utils/storage.server", () => ({
  parsePdfFormData: vi.fn(),
  getPublicFileURL: vi.fn(
    ({ filename }: { filename: string }) =>
      `https://example.supabase.co/storage/v1/object/public/files/${filename}`
  ),
  removePublicFile: vi.fn(),
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
  getPublicFileURL,
  parsePdfFormData,
  removePublicFile,
} from "~/utils/storage.server";
import { removeAssetAttachment, updateAssetAttachment } from "./service.server";

describe("asset attachment", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("updateAssetAttachment", () => {
    it("uploads a new attachment and persists its url/name/size", async () => {
      vi.mocked(db.asset.findFirstOrThrow).mockResolvedValue({
        id: "asset-1",
        attachmentUrl: null,
      } as any);

      const returnedFormData = new FormData();
      returnedFormData.append(
        "file",
        JSON.stringify({
          path: "org-1/asset-1/attachment-123.pdf",
          originalName: "invoice.pdf",
          size: 1234,
        })
      );
      vi.mocked(parsePdfFormData).mockResolvedValue(returnedFormData);
      vi.mocked(db.asset.update).mockResolvedValue({
        id: "asset-1",
        attachmentOriginalName: "invoice.pdf",
      } as any);

      const result = await updateAssetAttachment({
        request: {} as Request,
        assetId: "asset-1",
        organizationId: "org-1",
      });

      expect(getPublicFileURL).toHaveBeenCalledWith({
        filename: "org-1/asset-1/attachment-123.pdf",
        bucketName: "files",
      });
      expect(removePublicFile).not.toHaveBeenCalled();
      expect(db.asset.update).toHaveBeenCalledWith({
        where: { id: "asset-1", organizationId: "org-1" },
        data: {
          attachmentUrl:
            "https://example.supabase.co/storage/v1/object/public/files/org-1/asset-1/attachment-123.pdf",
          attachmentOriginalName: "invoice.pdf",
          attachmentSize: 1234,
        },
      });
      expect(result.attachmentOriginalName).toBe("invoice.pdf");
    });

    it("deletes the previous attachment when replacing one", async () => {
      vi.mocked(db.asset.findFirstOrThrow).mockResolvedValue({
        id: "asset-1",
        attachmentUrl:
          "https://example.supabase.co/storage/v1/object/public/files/org-1/asset-1/attachment-old.pdf",
      } as any);

      const returnedFormData = new FormData();
      returnedFormData.append(
        "file",
        JSON.stringify({
          path: "org-1/asset-1/attachment-new.pdf",
          originalName: "invoice-2.pdf",
          size: 999,
        })
      );
      vi.mocked(parsePdfFormData).mockResolvedValue(returnedFormData);
      vi.mocked(db.asset.update).mockResolvedValue({} as any);

      await updateAssetAttachment({
        request: {} as Request,
        assetId: "asset-1",
        organizationId: "org-1",
      });

      expect(removePublicFile).toHaveBeenCalledWith({
        publicUrl:
          "https://example.supabase.co/storage/v1/object/public/files/org-1/asset-1/attachment-old.pdf",
      });
    });

    it("throws and does not touch the db when no file was uploaded", async () => {
      vi.mocked(db.asset.findFirstOrThrow).mockResolvedValue({
        id: "asset-1",
        attachmentUrl: null,
      } as any);
      vi.mocked(parsePdfFormData).mockResolvedValue(new FormData());

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
        attachmentUrl:
          "https://example.supabase.co/storage/v1/object/public/files/org-1/asset-1/attachment-old.pdf",
      } as any);
      vi.mocked(removePublicFile).mockRejectedValue(new Error("gone already"));

      const returnedFormData = new FormData();
      returnedFormData.append(
        "file",
        JSON.stringify({
          path: "org-1/asset-1/attachment-new.pdf",
          originalName: "invoice-2.pdf",
          size: 999,
        })
      );
      vi.mocked(parsePdfFormData).mockResolvedValue(returnedFormData);
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
    it("deletes the file and clears the attachment fields", async () => {
      vi.mocked(db.asset.findFirstOrThrow).mockResolvedValue({
        id: "asset-1",
        attachmentUrl:
          "https://example.supabase.co/storage/v1/object/public/files/org-1/asset-1/attachment-123.pdf",
      } as any);
      // Explicit, since a previous test in this file leaves removePublicFile
      // rejecting - vi.clearAllMocks() (in beforeEach) resets call history
      // but not a configured mockRejectedValue/mockResolvedValue.
      vi.mocked(removePublicFile).mockResolvedValue(undefined as any);
      vi.mocked(db.asset.update).mockResolvedValue({} as any);

      await removeAssetAttachment({
        assetId: "asset-1",
        organizationId: "org-1",
      });

      expect(removePublicFile).toHaveBeenCalledWith({
        publicUrl:
          "https://example.supabase.co/storage/v1/object/public/files/org-1/asset-1/attachment-123.pdf",
      });
      expect(db.asset.update).toHaveBeenCalledWith({
        where: { id: "asset-1", organizationId: "org-1" },
        data: {
          attachmentUrl: null,
          attachmentOriginalName: null,
          attachmentSize: null,
        },
      });
    });

    it("is a no-op deletion when there is no existing attachment", async () => {
      vi.mocked(db.asset.findFirstOrThrow).mockResolvedValue({
        id: "asset-1",
        attachmentUrl: null,
      } as any);
      vi.mocked(db.asset.update).mockResolvedValue({} as any);

      await removeAssetAttachment({
        assetId: "asset-1",
        organizationId: "org-1",
      });

      expect(removePublicFile).not.toHaveBeenCalled();
      expect(db.asset.update).toHaveBeenCalled();
    });
  });
});
