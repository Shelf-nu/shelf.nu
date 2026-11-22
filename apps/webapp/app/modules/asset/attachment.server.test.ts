/**
 * Tests for asset attachments: the key and path rules that keep every object
 * inside the caller's workspace folder, the name cleaning, and the service
 * functions that upload, replace, stage, check and remove an asset's PDF.
 *
 * Storage and the database are mocked; see the `why:` comment on each mock.
 *
 * @see {@link file://./attachment.server.ts}
 */
import type { Asset } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

// why: Supabase Storage is an external service. Each test sets the upload
// result, folder listing or failure it needs, and asserts the keys sent.
vi.mock("~/utils/storage.server", () => ({
  parsePdfFormData: vi.fn(),
  createSignedUrl: vi.fn(
    ({ filename }: { filename: string }) =>
      `https://example.supabase.co/storage/v1/object/sign/assets/${filename}?token=signed`
  ),
  listFilesInFolder: vi.fn(),
  removeFileAtPath: vi.fn(),
  removeFilesByPrefix: vi.fn(),
}));

// why: no real Postgres in unit tests. Each case sets the exact "before" row
// and asserts the exact write.
vi.mock("~/database/db.server", () => ({
  db: {
    asset: {
      findFirst: vi.fn(),
      findFirstOrThrow: vi.fn(),
      update: vi.fn(),
    },
  },
}));

import { db } from "~/database/db.server";
import { ShelfError } from "~/utils/error";
import {
  createSignedUrl,
  listFilesInFolder,
  parsePdfFormData,
  removeFileAtPath,
  removeFilesByPrefix,
} from "~/utils/storage.server";
import {
  buildAttachmentKey,
  clearStagedAssetAttachment,
  MAX_ATTACHMENT_NAME_LENGTH,
  parseAttachmentPath,
  removeAssetAttachment,
  resolveAssetAttachmentDisplayUrl,
  resolveStagedAttachment,
  sanitizeAttachmentName,
  stageAssetAttachment,
  updateAssetAttachment,
} from "./attachment.server";

const ORG = "org-A";
const PLACEHOLDER = "5f0c6a2e-1111-4222-8333-444455556666";
const FILE_NAME =
  "attachment-1760000000-0b7f1a2c-3d4e-4f5a-8b6c-7d8e9f0a1b2c.pdf";
const STAGED_PATH = `${ORG}/${PLACEHOLDER}/${FILE_NAME}`;

/**
 * `db.asset.findFirstOrThrow` is mocked, but its static type is still the
 * full Prisma `Asset`. These tests only need the two fields the code selects.
 */
function mockAssetRow(row: Pick<Asset, "id" | "attachmentPath">): Asset {
  return row as Asset;
}

describe("asset attachment", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(removeFileAtPath).mockResolvedValue(undefined);
  });

  describe("buildAttachmentKey", () => {
    it("builds a key inside the workspace and folder", () => {
      const key = buildAttachmentKey({
        organizationId: ORG,
        folderId: PLACEHOLDER,
      });

      expect(`${key}.pdf`).toMatch(
        new RegExp(
          `^${ORG}/${PLACEHOLDER}/attachment-\\d+-[0-9a-f-]{36}\\.pdf$`
        )
      );
      expect(parseAttachmentPath(`${key}.pdf`, ORG)).not.toBeNull();
    });

    it.each([
      [".."],
      ["."],
      ["../org-B/asset-b"],
      ["asset%2F.."],
      [""],
      ["a".repeat(65)],
    ])("refuses the folder id %j", (folderId) => {
      expect(() =>
        buildAttachmentKey({ organizationId: ORG, folderId })
      ).toThrow(ShelfError);
    });
  });

  describe("parseAttachmentPath", () => {
    it("accepts an attachment key of the caller's workspace", () => {
      expect(parseAttachmentPath(STAGED_PATH, ORG)).toEqual({
        folderId: PLACEHOLDER,
        fileName: FILE_NAME,
      });
    });

    it.each([
      ["another workspace", `org-B/${PLACEHOLDER}/${FILE_NAME}`],
      ["a climb out of the workspace", `${ORG}/../org-B/asset-b/${FILE_NAME}`],
      ["a dot folder", `${ORG}/./${FILE_NAME}`],
      ["an extra segment", `${ORG}/${PLACEHOLDER}/nested/${FILE_NAME}`],
      [
        "another kind of file",
        `${ORG}/${PLACEHOLDER}/main-image-1760000000.png`,
      ],
      ["a non-pdf extension", STAGED_PATH.replace(/\.pdf$/, ".png")],
      ["a leading slash", `/${STAGED_PATH}`],
    ])("refuses %s", (_case, path) => {
      expect(parseAttachmentPath(path, ORG)).toBeNull();
    });
  });

  describe("sanitizeAttachmentName", () => {
    it("removes bidi overrides so the name reads as what it is", () => {
      expect(sanitizeAttachmentName("invoice‮fdp.exe")).toBe("invoicefdp.exe");
    });

    it("removes control and zero-width characters and trims", () => {
      expect(sanitizeAttachmentName("  in\u0000voi​ce.pdf\n")).toBe(
        "invoice.pdf"
      );
    });

    it("caps the length without splitting a character", () => {
      const name = `${"😀".repeat(MAX_ATTACHMENT_NAME_LENGTH + 10)}.pdf`;
      const cleaned = sanitizeAttachmentName(name);

      expect(Array.from(cleaned ?? "")).toHaveLength(
        MAX_ATTACHMENT_NAME_LENGTH
      );
      expect(cleaned).not.toContain("�");
    });

    it("returns null when nothing readable is left", () => {
      expect(sanitizeAttachmentName("‮​ ")).toBeNull();
      expect(sanitizeAttachmentName(undefined)).toBeNull();
    });
  });

  describe("updateAssetAttachment", () => {
    it("uploads into the asset's folder and stores the path, not a URL", async () => {
      vi.mocked(db.asset.findFirstOrThrow).mockResolvedValue(
        mockAssetRow({ id: "asset-1", attachmentPath: null })
      );
      vi.mocked(parsePdfFormData).mockResolvedValue({
        path: "org-1/asset-1/attachment-123.pdf",
        originalName: "invoice‮fdp.pdf",
        size: 1234,
      });
      vi.mocked(db.asset.update).mockResolvedValue({} as Asset);

      await updateAssetAttachment({
        request: {} as Request,
        assetId: "asset-1",
        organizationId: "org-1",
      });

      expect(parsePdfFormData).toHaveBeenCalledWith(
        expect.objectContaining({
          newFileName: expect.stringMatching(/^org-1\/asset-1\/attachment-/),
        })
      );
      expect(removeFileAtPath).not.toHaveBeenCalled();
      expect(db.asset.update).toHaveBeenCalledWith({
        where: { id: "asset-1", organizationId: "org-1" },
        data: {
          attachmentPath: "org-1/asset-1/attachment-123.pdf",
          attachmentOriginalName: "invoicefdp.pdf",
          attachmentSize: 1234,
        },
      });
    });

    it("deletes only the replaced file's exact path", async () => {
      vi.mocked(db.asset.findFirstOrThrow).mockResolvedValue(
        mockAssetRow({
          id: "asset-1",
          attachmentPath: "org-1/asset-1/attachment-old.pdf",
        })
      );
      vi.mocked(parsePdfFormData).mockResolvedValue({
        path: "org-1/asset-1/attachment-new.pdf",
        originalName: "invoice-2.pdf",
        size: 999,
      });
      vi.mocked(db.asset.update).mockResolvedValue({} as Asset);

      await updateAssetAttachment({
        request: {} as Request,
        assetId: "asset-1",
        organizationId: "org-1",
      });

      expect(removeFileAtPath).toHaveBeenCalledWith({
        path: "org-1/asset-1/attachment-old.pdf",
        bucketName: "assets",
      });
      expect(removeFilesByPrefix).not.toHaveBeenCalled();
    });

    it("does not touch the db when the upload is refused", async () => {
      vi.mocked(db.asset.findFirstOrThrow).mockResolvedValue(
        mockAssetRow({ id: "asset-1", attachmentPath: null })
      );
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

    it("keeps the new attachment when deleting the old file fails", async () => {
      vi.mocked(db.asset.findFirstOrThrow).mockResolvedValue(
        mockAssetRow({
          id: "asset-1",
          attachmentPath: "org-1/asset-1/attachment-old.pdf",
        })
      );
      vi.mocked(removeFileAtPath).mockRejectedValue(new Error("gone already"));
      vi.mocked(parsePdfFormData).mockResolvedValue({
        path: "org-1/asset-1/attachment-new.pdf",
        originalName: "invoice-2.pdf",
        size: 999,
      });
      vi.mocked(db.asset.update).mockResolvedValue({} as Asset);

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
    it("clears the columns, then deletes the file at its exact path", async () => {
      vi.mocked(db.asset.findFirstOrThrow).mockResolvedValue(
        mockAssetRow({
          id: "asset-1",
          attachmentPath: "org-1/asset-1/attachment-123.pdf",
        })
      );
      vi.mocked(db.asset.update).mockResolvedValue({} as Asset);

      await removeAssetAttachment({
        assetId: "asset-1",
        organizationId: "org-1",
      });

      expect(db.asset.update).toHaveBeenCalledWith({
        where: { id: "asset-1", organizationId: "org-1" },
        data: {
          attachmentPath: null,
          attachmentOriginalName: null,
          attachmentSize: null,
        },
      });
      expect(removeFileAtPath).toHaveBeenCalledWith({
        path: "org-1/asset-1/attachment-123.pdf",
        bucketName: "assets",
      });
    });

    it("deletes nothing when there is no attachment", async () => {
      vi.mocked(db.asset.findFirstOrThrow).mockResolvedValue(
        mockAssetRow({ id: "asset-1", attachmentPath: null })
      );
      vi.mocked(db.asset.update).mockResolvedValue({} as Asset);

      await removeAssetAttachment({
        assetId: "asset-1",
        organizationId: "org-1",
      });

      expect(removeFileAtPath).not.toHaveBeenCalled();
      expect(db.asset.update).toHaveBeenCalled();
    });
  });

  describe("stageAssetAttachment", () => {
    it("uploads into the placeholder folder and returns the path, cleaned name and size", async () => {
      vi.mocked(parsePdfFormData).mockResolvedValue({
        path: STAGED_PATH,
        originalName: "invoice.pdf",
        size: 1234,
      });

      const result = await stageAssetAttachment({
        request: {} as Request,
        placeholderId: PLACEHOLDER,
        organizationId: ORG,
      });

      expect(parsePdfFormData).toHaveBeenCalledWith(
        expect.objectContaining({
          newFileName: expect.stringContaining(
            `${ORG}/${PLACEHOLDER}/attachment-`
          ),
        })
      );
      expect(result).toMatchObject({
        attachmentPath: STAGED_PATH,
        attachmentOriginalName: "invoice.pdf",
        attachmentSize: 1234,
      });
      expect(createSignedUrl).toHaveBeenCalledWith({
        filename: STAGED_PATH,
        bucketName: "assets",
      });
    });

    it("refuses a placeholder id that would leave the workspace folder", async () => {
      await expect(
        stageAssetAttachment({
          request: {} as Request,
          placeholderId: "../org-B/asset-b",
          organizationId: ORG,
        })
      ).rejects.toMatchObject({ status: 400 });

      expect(parsePdfFormData).not.toHaveBeenCalled();
    });
  });

  describe("clearStagedAssetAttachment", () => {
    it("clears the placeholder folder", async () => {
      await clearStagedAssetAttachment({
        placeholderId: PLACEHOLDER,
        organizationId: ORG,
      });

      expect(removeFilesByPrefix).toHaveBeenCalledWith({
        organizationId: ORG,
        entityId: PLACEHOLDER,
        bucketName: "assets",
      });
    });

    it("refuses a placeholder id that is a dot segment", async () => {
      await expect(
        clearStagedAssetAttachment({ placeholderId: "..", organizationId: ORG })
      ).rejects.toMatchObject({ status: 400 });

      expect(removeFilesByPrefix).not.toHaveBeenCalled();
    });
  });

  describe("resolveStagedAttachment", () => {
    it("returns the path, the cleaned name and the size Storage recorded", async () => {
      vi.mocked(db.asset.findFirst).mockResolvedValue(null);
      vi.mocked(listFilesInFolder).mockResolvedValue([
        { name: FILE_NAME, size: 4321 },
      ]);

      const result = await resolveStagedAttachment({
        attachmentPath: STAGED_PATH,
        attachmentOriginalName: "invoice‮fdp.pdf",
        organizationId: ORG,
      });

      expect(result).toEqual({
        attachmentPath: STAGED_PATH,
        attachmentOriginalName: "invoicefdp.pdf",
        attachmentSize: 4321,
      });
      expect(listFilesInFolder).toHaveBeenCalledWith({
        folder: `${ORG}/${PLACEHOLDER}`,
        bucketName: "assets",
      });
    });

    it.each([
      ["climbs into another workspace", `${ORG}/../org-B/asset-b/${FILE_NAME}`],
      ["belongs to another workspace", `org-B/${PLACEHOLDER}/${FILE_NAME}`],
      ["is not an attachment", `${ORG}/other-entity/not-an-attachment.png`],
    ])(
      "refuses a path that %s before reading anything",
      async (_case, path) => {
        await expect(
          resolveStagedAttachment({
            attachmentPath: path,
            organizationId: ORG,
          })
        ).rejects.toMatchObject({ status: 400 });

        expect(db.asset.findFirst).not.toHaveBeenCalled();
        expect(listFilesInFolder).not.toHaveBeenCalled();
      }
    );

    it("refuses a path another asset already owns", async () => {
      vi.mocked(db.asset.findFirst).mockResolvedValue({
        id: "asset-owning-it",
      } as Asset);

      await expect(
        resolveStagedAttachment({
          attachmentPath: STAGED_PATH,
          organizationId: ORG,
        })
      ).rejects.toMatchObject({ status: 400 });

      expect(listFilesInFolder).not.toHaveBeenCalled();
    });

    it("refuses a path with no file behind it", async () => {
      vi.mocked(db.asset.findFirst).mockResolvedValue(null);
      vi.mocked(listFilesInFolder).mockResolvedValue([
        { name: "attachment-other.pdf", size: 10 },
      ]);

      await expect(
        resolveStagedAttachment({
          attachmentPath: STAGED_PATH,
          organizationId: ORG,
        })
      ).rejects.toMatchObject({ status: 400, title: "Attachment not found" });
    });
  });

  describe("resolveAssetAttachmentDisplayUrl", () => {
    it("returns null without calling Storage when there is no attachment", async () => {
      const result = await resolveAssetAttachmentDisplayUrl({
        attachmentPath: null,
        assetId: "asset-1",
      });

      expect(result).toBeNull();
      expect(createSignedUrl).not.toHaveBeenCalled();
    });

    it("returns null instead of throwing when signing fails", async () => {
      vi.mocked(createSignedUrl).mockRejectedValueOnce(
        new Error("Supabase is down")
      );

      const result = await resolveAssetAttachmentDisplayUrl({
        attachmentPath: STAGED_PATH,
        assetId: "asset-1",
      });

      expect(result).toBeNull();
    });
  });
});
