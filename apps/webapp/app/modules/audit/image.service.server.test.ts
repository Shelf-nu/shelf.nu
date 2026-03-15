import { beforeEach, describe, expect, it, vi } from "vitest";

// why: We need to mock storage operations to avoid actually uploading files during tests
vi.mock("~/utils/storage.server", () => ({
  parseFileFormData: vi.fn(),
  removePublicFile: vi.fn(),
  getFileUploadPath: vi.fn(
    (params: any) =>
      `${params.organizationId}/${params.type}/${params.typeId}/test.jpg`
  ),
}));

// why: Stub the db export so imports resolve; actual queries go through query helpers
vi.mock("~/database/db.server", () => ({ db: {} }));

// why: Auto-mock query helpers so we can control return values per test
vi.mock("~/database/query-helpers.server");

// why: Mock Supabase client to avoid real storage calls
vi.mock("~/integrations/supabase/client", () => ({
  getSupabaseAdmin: vi.fn(() => ({
    storage: {
      from: vi.fn(() => ({
        getPublicUrl: vi.fn((path: string) => ({
          data: { publicUrl: path },
        })),
      })),
    },
  })),
}));

import {
  create,
  findFirst,
  findMany,
  remove as removeRecord,
  count,
} from "~/database/query-helpers.server";
import { parseFileFormData, removePublicFile } from "~/utils/storage.server";

import {
  deleteAuditImage,
  getAuditImageCount,
  getAuditImages,
  uploadAuditImage,
} from "./image.service.server";

describe("audit image service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("uploadAuditImage", () => {
    it("successfully uploads an image with valid file", async () => {
      const mockFormData = new FormData();
      const mockFile = new File(["test"], "test.jpg", { type: "image/jpeg" });
      mockFormData.append("auditImage", mockFile);

      // Mock parseFileFormData to return FormData with image and thumbnail paths
      const mockReturnFormData = new FormData();
      mockReturnFormData.append(
        "image",
        JSON.stringify({
          originalPath: "org-1/audits/audit-1/image-123.jpg",
          thumbnailPath: "org-1/audits/audit-1/image-123-thumbnail.jpg",
        })
      );
      vi.mocked(parseFileFormData).mockResolvedValue(mockReturnFormData);

      vi.mocked(count).mockResolvedValue(0);
      vi.mocked(create).mockResolvedValue({
        id: "img-1",
        auditSessionId: "audit-1",
        auditAssetId: null,
        organizationId: "org-1",
        imageUrl: "org-1/audits/audit-1/image-123.jpg",
        thumbnailUrl: "org-1/audits/audit-1/image-123-thumbnail.jpg",
        description: null,
        uploadedById: "user-1",
        createdAt: new Date(),
        updatedAt: new Date(),
      } as any);

      const result = await uploadAuditImage({
        request: {
          formData: () => Promise.resolve(mockFormData),
        } as any,
        auditSessionId: "audit-1",
        auditAssetId: undefined,
        organizationId: "org-1",
        uploadedById: "user-1",
      });

      expect(parseFileFormData).toHaveBeenCalledWith(
        expect.objectContaining({
          request: expect.anything(),
          bucketName: "files",
          generateThumbnail: true,
          thumbnailSize: 108,
        })
      );

      expect(vi.mocked(create)).toHaveBeenCalled();
      expect(result).toEqual(
        expect.objectContaining({
          id: "img-1",
          imageUrl: "org-1/audits/audit-1/image-123.jpg",
        })
      );
    });

    it("throws error when no image file is provided", async () => {
      const mockFormData = new FormData();

      // Mock parseFileFormData to return FormData without image
      const mockReturnFormData = new FormData();
      vi.mocked(parseFileFormData).mockResolvedValue(mockReturnFormData);

      vi.mocked(count).mockResolvedValue(0);

      await expect(
        uploadAuditImage({
          request: {
            formData: () => Promise.resolve(mockFormData),
          } as any,
          auditSessionId: "audit-1",
          auditAssetId: undefined,
          organizationId: "org-1",
          uploadedById: "user-1",
        })
      ).rejects.toThrow();
    });

    it("validates limit for asset-specific images (3 max)", async () => {
      vi.mocked(parseFileFormData).mockResolvedValue(new FormData());
      vi.mocked(count).mockResolvedValue(3);

      await expect(
        uploadAuditImage({
          request: {
            formData: () => Promise.resolve(new FormData()),
          } as any,
          auditSessionId: "audit-1",
          auditAssetId: "asset-1",
          organizationId: "org-1",
          uploadedById: "user-1",
        })
      ).rejects.toThrow();
    });

    it("validates limit for general audit images (5 max)", async () => {
      vi.mocked(parseFileFormData).mockResolvedValue(new FormData());
      vi.mocked(count).mockResolvedValue(5);

      await expect(
        uploadAuditImage({
          request: {
            formData: () => Promise.resolve(new FormData()),
          } as any,
          auditSessionId: "audit-1",
          auditAssetId: undefined,
          organizationId: "org-1",
          uploadedById: "user-1",
        })
      ).rejects.toThrow();
    });
  });

  describe("deleteAuditImage", () => {
    it("successfully deletes image from storage and database", async () => {
      vi.mocked(findFirst).mockResolvedValue({
        id: "img-1",
        auditSessionId: "audit-1",
        auditAssetId: null,
        organizationId: "org-1",
        imageUrl: "org-1/audits/audit-1/image-123.jpg",
        thumbnailUrl: "org-1/audits/audit-1/image-123-thumbnail.jpg",
        description: null,
        uploadedById: "user-1",
        createdAt: new Date(),
        updatedAt: new Date(),
      } as any);

      vi.mocked(removeRecord).mockResolvedValue(undefined as any);
      vi.mocked(removePublicFile).mockResolvedValue(undefined);

      await deleteAuditImage({
        imageId: "img-1",
        organizationId: "org-1",
      });

      expect(vi.mocked(findFirst)).toHaveBeenCalledWith(
        expect.anything(),
        "AuditImage",
        {
          where: { id: "img-1", organizationId: "org-1" },
        }
      );

      expect(removePublicFile).toHaveBeenCalledWith({
        publicUrl: "org-1/audits/audit-1/image-123.jpg",
      });

      expect(removePublicFile).toHaveBeenCalledWith({
        publicUrl: "org-1/audits/audit-1/image-123-thumbnail.jpg",
      });

      expect(vi.mocked(removeRecord)).toHaveBeenCalledWith(
        expect.anything(),
        "AuditImage",
        { id: "img-1" }
      );
    });

    it("throws error when image not found", async () => {
      vi.mocked(findFirst).mockResolvedValue(null as any);

      await expect(
        deleteAuditImage({
          imageId: "nonexistent",
          organizationId: "org-1",
        })
      ).rejects.toThrow();

      expect(vi.mocked(removeRecord)).not.toHaveBeenCalled();
    });
  });

  describe("getAuditImages", () => {
    it("fetches all images for an audit", async () => {
      const mockImages = [
        {
          id: "img-1",
          auditSessionId: "audit-1",
          auditAssetId: null,
          organizationId: "org-1",
          imageUrl: "org-1/audits/audit-1/image-1.jpg",
          thumbnailUrl: "org-1/audits/audit-1/image-1-thumbnail.jpg",
          description: null,
          uploadedById: "user-1",
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          id: "img-2",
          auditSessionId: "audit-1",
          auditAssetId: null,
          organizationId: "org-1",
          imageUrl: "org-1/audits/audit-1/image-2.jpg",
          thumbnailUrl: "org-1/audits/audit-1/image-2-thumbnail.jpg",
          description: null,
          uploadedById: "user-1",
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];

      vi.mocked(findMany).mockImplementation((_db, table, _opts?) => {
        if (table === "AuditImage") {
          return Promise.resolve(mockImages as any);
        }
        if (table === "User") {
          return Promise.resolve([
            {
              id: "user-1",
              firstName: "Test",
              lastName: "User",
              profilePicture: null,
            },
          ] as any);
        }
        return Promise.resolve([]);
      });

      const result = await getAuditImages({
        auditSessionId: "audit-1",
        organizationId: "org-1",
      });

      expect(vi.mocked(findMany)).toHaveBeenCalledWith(
        expect.anything(),
        "AuditImage",
        {
          where: {
            auditSessionId: "audit-1",
            organizationId: "org-1",
          },
          orderBy: { createdAt: "desc" },
        }
      );

      expect(result).toHaveLength(2);
    });

    it("filters images by auditAssetId when provided", async () => {
      vi.mocked(findMany).mockResolvedValue([]);

      await getAuditImages({
        auditSessionId: "audit-1",
        organizationId: "org-1",
        auditAssetId: "asset-1",
      });

      expect(vi.mocked(findMany)).toHaveBeenCalledWith(
        expect.anything(),
        "AuditImage",
        expect.objectContaining({
          where: expect.objectContaining({
            auditAssetId: "asset-1",
          }),
        })
      );
    });
  });

  describe("getAuditImageCount", () => {
    it("counts all images for an audit", async () => {
      vi.mocked(count).mockResolvedValue(3);

      const result = await getAuditImageCount({
        auditSessionId: "audit-1",
        organizationId: "org-1",
      });

      expect(vi.mocked(count)).toHaveBeenCalledWith(
        expect.anything(),
        "AuditImage",
        {
          auditSessionId: "audit-1",
          organizationId: "org-1",
        }
      );

      expect(result).toBe(3);
    });

    it("counts images for specific asset", async () => {
      vi.mocked(count).mockResolvedValue(2);

      const result = await getAuditImageCount({
        auditSessionId: "audit-1",
        organizationId: "org-1",
        auditAssetId: "asset-1",
      });

      expect(vi.mocked(count)).toHaveBeenCalledWith(
        expect.anything(),
        "AuditImage",
        {
          auditSessionId: "audit-1",
          organizationId: "org-1",
          auditAssetId: "asset-1",
        }
      );

      expect(result).toBe(2);
    });
  });
});
