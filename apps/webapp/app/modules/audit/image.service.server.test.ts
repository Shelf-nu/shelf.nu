import sharp from "sharp";
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

vi.mock("~/utils/date-format.server", () => ({
  // why: resolving the uploader's time zone reads their user row from the DB
  resolveUserFormatPrefsById: vi.fn().mockResolvedValue({
    timeZone: "America/New_York",
  }),
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
        capturedAt: null,
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

      // Expected limit-validation (a 400) — not a server error, so it must
      // not be captured to Sentry (was noise: SHELF-WEBAPP-1KT).
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
      ).rejects.toMatchObject({
        message: "Maximum of 3 images per asset exceeded",
        status: 400,
        shouldBeCaptured: false,
      });
    });

    it("validates limit for general audit images (5 max)", async () => {
      // Mock audit image model exists
      vi.mocked(parseFileFormData).mockResolvedValue(new FormData());
      vi.mocked(db.auditImage.count).mockResolvedValue(5);

      // Expected limit-validation (a 400) — not a server error, so it must
      // not be captured to Sentry (sibling of SHELF-WEBAPP-1KT).
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
      ).rejects.toMatchObject({
        message: "Maximum of 5 general images per audit exceeded",
        status: 400,
        shouldBeCaptured: false,
      });
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
        capturedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      vi.mocked(db.auditImage.delete).mockResolvedValue({} as any);
      vi.mocked(removePublicFile).mockResolvedValue(undefined);

      await deleteAuditImage({
        imageId: "img-1",
        organizationId: "org-1",
        auditSessionId: "audit-1",
      });

      // The `auditSessionId` predicate is the point: `imageId` is
      // caller-supplied, so an org-only filter let any member delete any
      // image in the workspace through a URL naming a different audit.
      expect(db.auditImage.findFirst).toHaveBeenCalledWith({
        where: {
          id: "img-1",
          organizationId: "org-1",
          auditSessionId: "audit-1",
        },
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
          auditSessionId: "audit-1",
        })
      ).rejects.toThrow();

      expect(db.auditImage.delete).not.toHaveBeenCalled();
    });

    it("refuses an image that belongs to a different audit", async () => {
      // The reported vector: a real image id, submitted through a URL naming
      // an audit it does not belong to. The scoped lookup matches nothing.
      vi.mocked(db.auditImage.findFirst).mockResolvedValue(null);

      await expect(
        deleteAuditImage({
          imageId: "img-from-another-audit",
          organizationId: "org-1",
          auditSessionId: "audit-the-caller-named",
        })
      ).rejects.toThrow();

      expect(db.auditImage.findFirst).toHaveBeenCalledWith({
        where: {
          id: "img-from-another-audit",
          organizationId: "org-1",
          auditSessionId: "audit-the-caller-named",
        },
      });
      // Nothing deleted, and crucially no storage object removed — the files
      // go before the row, so an unscoped lookup destroys the evidence even
      // if the DB delete were to fail afterwards.
      expect(db.auditImage.delete).not.toHaveBeenCalled();
      expect(removePublicFile).not.toHaveBeenCalled();
    });

    it("binds to the audit ASSET too when the route names one", async () => {
      vi.mocked(db.auditImage.findFirst).mockResolvedValue(null);

      await expect(
        deleteAuditImage({
          imageId: "img-1",
          organizationId: "org-1",
          auditSessionId: "audit-1",
          auditAssetId: "auditasset-1",
        })
      ).rejects.toThrow();

      expect(db.auditImage.findFirst).toHaveBeenCalledWith({
        where: {
          id: "img-1",
          organizationId: "org-1",
          auditSessionId: "audit-1",
          auditAssetId: "auditasset-1",
        },
      });
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
          capturedAt: null,
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
          capturedAt: null,
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
              displayName: true,
              profilePicture: true,
            },
          },
          auditAsset: {
            include: {
              asset: {
                select: {
                  id: true,
                  title: true,
                },
              },
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

describe("uploadAuditImage returnParsedFormData", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns the bounded-parsed formData alongside the image", async () => {
    // why: parseFileFormData is the bounded (maxFileSize) streaming parser;
    // @remix-run/form-data-parser passes text fields through, so the caller
    // need not re-parse the body unbounded.
    const fd = new FormData();
    fd.set("image", JSON.stringify({ originalPath: "p", thumbnailPath: "t" }));
    fd.set("content", "Dent on top");
    vi.mocked(parseFileFormData).mockResolvedValue(fd);

    // why: external DB — count returns 0 so the per-asset/per-audit image
    // limit check passes; create returns a deterministic row so the asserted
    // return shape ({ image, formData }) is stable without a real Prisma tx.
    vi.mocked(db.auditImage.count).mockResolvedValue(0);
    vi.mocked(db.auditImage.create).mockResolvedValue({
      id: "img-ret-1",
      auditSessionId: "session-1",
      auditAssetId: "audit-asset-1",
      organizationId: "org-1",
      imageUrl: "https://example.com/p",
      thumbnailUrl: "https://example.com/t",
      description: null,
      uploadedById: "user-1",
      capturedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const result = await uploadAuditImage({
      request: new Request("http://localhost", { method: "POST" }),
      auditSessionId: "session-1",
      organizationId: "org-1",
      uploadedById: "user-1",
      auditAssetId: "audit-asset-1",
      returnParsedFormData: true,
    });

    expect(result).toHaveProperty("image");
    expect(result).toHaveProperty("formData");
    expect((result as any).formData.get("content")).toBe("Dent on top");
    expect((result as any).image.id).toBe("img-ret-1");
  });

  describe("uploadAuditImage: when the photo was taken", () => {
    /** A tiny JPEG carrying the given EXIF (IFD2 is the Exif sub-directory). */
    async function jpeg(exif?: Record<string, string>) {
      const image = sharp({
        create: { width: 8, height: 8, channels: 3, background: "red" },
      }).jpeg();
      return (exif ? image.withExif({ IFD2: exif }) : image).toBuffer();
    }

    /**
     * Stands in for the storage upload: hands `original` to the service's
     * `inspectOriginal` exactly as the real parser does, then returns the
     * parsed form with the stored path and any text fields the client sent.
     */
    function uploadReceives(
      original: Buffer,
      fields: Record<string, string> = {}
    ) {
      vi.mocked(parseFileFormData).mockImplementation(async (args) => {
        await args.inspectOriginal?.(original);
        const parsed = new FormData();
        parsed.append(
          "image",
          JSON.stringify({ originalPath: "org-1/audits/audit-1/p.jpg" })
        );
        for (const [name, value] of Object.entries(fields)) {
          parsed.append(name, value);
        }
        return parsed;
      });
    }

    async function upload() {
      vi.mocked(db.auditImage.count).mockResolvedValue(0);
      vi.mocked(db.auditImage.create).mockImplementation(
        (args) => ({ id: "img-1", ...args.data }) as never
      );
      return uploadAuditImage({
        request: new Request("https://app.test/upload", { method: "POST" }),
        auditSessionId: "audit-1",
        organizationId: "org-1",
        uploadedById: "user-1",
      });
    }

    function storedCapturedAt() {
      return vi.mocked(db.auditImage.create).mock.calls[0][0].data.capturedAt;
    }

    it("stores the time from the file's own EXIF", async () => {
      uploadReceives(
        await jpeg({
          DateTimeOriginal: "2026:10:21 09:15:00",
          OffsetTimeOriginal: "+02:00",
        }),
        // The file's own date wins over the phone app's copy.
        { exifDateTimeOriginal: "2026:01:01 00:00:00" }
      );

      await upload();

      expect(storedCapturedAt()).toEqual(new Date("2026-10-21T07:15:00Z"));
    });

    it("reads an offset-less date in the uploader's time zone", async () => {
      uploadReceives(await jpeg({ DateTimeOriginal: "2026:10:21 09:15:00" }));

      await upload();

      // America/New_York in October is UTC-4.
      expect(storedCapturedAt()).toEqual(new Date("2026-10-21T13:15:00Z"));
    });

    it("falls back to the phone app's fields when the file has no EXIF", async () => {
      // The phone app's HEIC to JPEG conversion drops EXIF, so its copy of the
      // tags is the only date the server gets.
      uploadReceives(await jpeg(), {
        exifDateTimeOriginal: "2026:10:20 18:30:00",
        exifOffsetTimeOriginal: "-07:00",
      });

      await upload();

      expect(storedCapturedAt()).toEqual(new Date("2026-10-21T01:30:00Z"));
    });

    it("stores null, and still uploads, when neither has a date", async () => {
      uploadReceives(await jpeg());

      const image = await upload();

      expect(storedCapturedAt()).toBeNull();
      expect(image.id).toBe("img-1");
    });

    it("stores null, and still uploads, when the EXIF date is garbage", async () => {
      uploadReceives(await jpeg({ DateTimeOriginal: "0000:00:00 00:00:00" }));

      const image = await upload();

      expect(storedCapturedAt()).toBeNull();
      expect(image.id).toBe("img-1");
    });
  });
});
