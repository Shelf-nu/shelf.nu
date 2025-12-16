import { beforeEach, describe, expect, it, vi } from "vitest";
// Mock the dependencies
vi.mock("~/utils/storage.server", () => ({
  // why: We need to mock storage operations to avoid actually uploading files during tests
  parseFileFormData: vi.fn(),
  removePublicFile: vi.fn(),
  getFileUploadPath: vi.fn(
    (params) =>
      `${params.organizationId}/${params.type}/${params.typeId}/test.jpg`
  ),
}));

vi.mock("~/database/db.server", () => ({
  // why: We need to mock database queries to avoid hitting the real database during tests
  db: {
    auditImage: {
      count: vi.fn(),
      create: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      delete: vi.fn(),
    },
  },
}));

import { db } from "~/database/db.server";
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
          path: "org-1/audits/audit-1/image-123.jpg",
          thumbnailPath: "org-1/audits/audit-1/image-123-thumbnail.jpg",
        })
      );
      vi.mocked(parseFileFormData).mockResolvedValue(mockReturnFormData);

      vi.mocked(db.auditImage.count).mockResolvedValue(0);
      vi.mocked(db.auditImage.create).mockResolvedValue({
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
      });

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

      expect(db.auditImage.create).toHaveBeenCalled();
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

      vi.mocked(db.auditImage.count).mockResolvedValue(0);

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
      // Mock audit image model exists
      vi.mocked(parseFileFormData).mockResolvedValue(new FormData());
      vi.mocked(db.auditImage.count).mockResolvedValue(3);

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
      // Mock audit image model exists
      vi.mocked(parseFileFormData).mockResolvedValue(new FormData());
      vi.mocked(db.auditImage.count).mockResolvedValue(5);

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
      vi.mocked(db.auditImage.findFirst).mockResolvedValue({
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
      });

      vi.mocked(db.auditImage.delete).mockResolvedValue({} as any);
      vi.mocked(removePublicFile).mockResolvedValue(undefined);

      await deleteAuditImage({
        imageId: "img-1",
        organizationId: "org-1",
      });

      expect(db.auditImage.findFirst).toHaveBeenCalledWith({
        where: { id: "img-1", organizationId: "org-1" },
      });

      expect(removePublicFile).toHaveBeenCalledWith({
        publicUrl: "org-1/audits/audit-1/image-123.jpg",
      });

      expect(removePublicFile).toHaveBeenCalledWith({
        publicUrl: "org-1/audits/audit-1/image-123-thumbnail.jpg",
      });

      expect(db.auditImage.delete).toHaveBeenCalledWith({
        where: { id: "img-1" },
      });
    });

    it("throws error when image not found", async () => {
      vi.mocked(db.auditImage.findFirst).mockResolvedValue(null);

      await expect(
        deleteAuditImage({
          imageId: "nonexistent",
          organizationId: "org-1",
        })
      ).rejects.toThrow();

      expect(db.auditImage.delete).not.toHaveBeenCalled();
    });
  });

  describe("getAuditImages", () => {
    it("fetches all images for an audit", async () => {
      vi.mocked(db.auditImage.findMany).mockResolvedValue([
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
      ] as any);

      const result = await getAuditImages({
        auditSessionId: "audit-1",
        organizationId: "org-1",
      });

      expect(db.auditImage.findMany).toHaveBeenCalledWith({
        where: {
          auditSessionId: "audit-1",
          organizationId: "org-1",
        },
        include: {
          uploadedBy: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              profilePicture: true,
            },
          },
        },
        orderBy: { createdAt: "desc" },
      });

      expect(result).toHaveLength(2);
    });

    it("filters images by auditAssetId when provided", async () => {
      vi.mocked(db.auditImage.findMany).mockResolvedValue([]);

      await getAuditImages({
        auditSessionId: "audit-1",
        organizationId: "org-1",
        auditAssetId: "asset-1",
      });

      expect(db.auditImage.findMany).toHaveBeenCalledWith(
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
      vi.mocked(db.auditImage.count).mockResolvedValue(3);

      const result = await getAuditImageCount({
        auditSessionId: "audit-1",
        organizationId: "org-1",
      });

      expect(db.auditImage.count).toHaveBeenCalledWith({
        where: {
          auditSessionId: "audit-1",
          organizationId: "org-1",
        },
      });

      expect(result).toBe(3);
    });

    it("counts images for specific asset", async () => {
      vi.mocked(db.auditImage.count).mockResolvedValue(2);

      const result = await getAuditImageCount({
        auditSessionId: "audit-1",
        organizationId: "org-1",
        auditAssetId: "asset-1",
      });

      expect(db.auditImage.count).toHaveBeenCalledWith({
        where: {
          auditSessionId: "audit-1",
          organizationId: "org-1",
          auditAssetId: "asset-1",
        },
      });

      expect(result).toBe(2);
    });
  });
});
