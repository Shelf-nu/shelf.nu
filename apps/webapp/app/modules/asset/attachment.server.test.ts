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
  removeFilesAtPaths: vi.fn(),
}));

// why: no real Postgres in unit tests. Each case sets the exact "before" row
// and asserts the exact write.
vi.mock("~/database/db.server", () => ({
  db: {
    asset: {
      findFirst: vi.fn(),
      findFirstOrThrow: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
    },
  },
}));

import { db } from "~/database/db.server";
import { ShelfError } from "~/utils/error";
import { Logger } from "~/utils/logger";
import {
  createSignedUrl,
  listFilesInFolder,
  parsePdfFormData,
  removeFileAtPath,
  removeFilesAtPaths,
} from "~/utils/storage.server";
import {
  buildAttachmentKey,
  clearStagedAssetAttachment,
  MAX_ATTACHMENT_NAME_LENGTH,
  parseAttachmentPath,
  removeAssetAttachment,
  removeAttachmentFilesOfDeletedAssets,
  ATTACHMENT_LINK_TTL_SECONDS,
  findStagedAttachmentPath,
  resolveStagedAttachment,
  sanitizeAttachmentName,
  signAttachmentForViewing,
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

// why: Logger.error writes to the console and Sentry; spy on it to assert a
// best-effort failure is logged without producing output
let loggerErrorSpy: ReturnType<typeof vi.spyOn>;

describe("asset attachment", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    loggerErrorSpy = vi.spyOn(Logger, "error").mockImplementation(() => {});
    vi.mocked(removeFileAtPath).mockResolvedValue(undefined);
    vi.mocked(removeFilesAtPaths).mockResolvedValue(undefined);
    vi.mocked(listFilesInFolder).mockResolvedValue([]);
    vi.mocked(db.asset.findMany).mockResolvedValue([]);
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

      expect(removeFileAtPath).toHaveBeenCalledTimes(1);
      expect(removeFileAtPath).toHaveBeenCalledWith({
        path: "org-1/asset-1/attachment-old.pdf",
        bucketName: "assets",
      });
      expect(removeFilesAtPaths).not.toHaveBeenCalled();
    });

    it("removes the new file and keeps the old one when saving fails", async () => {
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
      vi.mocked(db.asset.update).mockRejectedValue(new Error("db down"));

      await expect(
        updateAssetAttachment({
          request: {} as Request,
          assetId: "asset-1",
          organizationId: "org-1",
        })
      ).rejects.toThrow();

      expect(removeFileAtPath).toHaveBeenCalledTimes(1);
      expect(removeFileAtPath).toHaveBeenCalledWith({
        path: "org-1/asset-1/attachment-new.pdf",
        bucketName: "assets",
      });
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
      // No signed URL: the form opens the file through the viewing route.
      expect(result).toEqual({
        attachmentPath: STAGED_PATH,
        attachmentOriginalName: "invoice.pdf",
        attachmentSize: 1234,
      });
      expect(createSignedUrl).not.toHaveBeenCalled();
    });

    it("removes files staged earlier under the placeholder, but not the new one", async () => {
      const earlier = FILE_NAME.replace("1760000000", "1750000000");
      vi.mocked(parsePdfFormData).mockResolvedValue({
        path: STAGED_PATH,
        originalName: "invoice.pdf",
        size: 1234,
      });
      vi.mocked(listFilesInFolder).mockResolvedValue([
        { name: earlier, size: 1 },
        { name: FILE_NAME, size: 1234 },
      ]);

      await stageAssetAttachment({
        request: {} as Request,
        placeholderId: PLACEHOLDER,
        organizationId: ORG,
      });

      expect(removeFilesAtPaths).toHaveBeenCalledWith({
        paths: [`${ORG}/${PLACEHOLDER}/${earlier}`],
        bucketName: "assets",
      });
    });

    it("still returns the staged file when cleaning up earlier ones fails", async () => {
      vi.mocked(parsePdfFormData).mockResolvedValue({
        path: STAGED_PATH,
        originalName: "invoice.pdf",
        size: 1234,
      });
      vi.mocked(listFilesInFolder).mockRejectedValue(new Error("timeout"));

      await expect(
        stageAssetAttachment({
          request: {} as Request,
          placeholderId: PLACEHOLDER,
          organizationId: ORG,
        })
      ).resolves.toMatchObject({ attachmentPath: STAGED_PATH });
      expect(loggerErrorSpy).toHaveBeenCalledTimes(1);
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
    it("removes the placeholder folder's files", async () => {
      vi.mocked(listFilesInFolder).mockResolvedValue([
        { name: FILE_NAME, size: 1 },
      ]);

      await clearStagedAssetAttachment({
        placeholderId: PLACEHOLDER,
        organizationId: ORG,
      });

      expect(removeFilesAtPaths).toHaveBeenCalledWith({
        paths: [STAGED_PATH],
        bucketName: "assets",
      });
    });

    it("never removes a file an asset already owns", async () => {
      const unowned = FILE_NAME.replace("1760000000", "1750000000");
      vi.mocked(listFilesInFolder).mockResolvedValue([
        { name: FILE_NAME, size: 1 },
        { name: unowned, size: 1 },
      ]);
      // why: the created asset stores the path it was staged under
      vi.mocked(db.asset.findMany).mockResolvedValue([
        { attachmentPath: STAGED_PATH } as Asset,
      ]);

      await clearStagedAssetAttachment({
        placeholderId: PLACEHOLDER,
        organizationId: ORG,
      });

      expect(db.asset.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            organizationId: ORG,
            attachmentPath: {
              in: [STAGED_PATH, `${ORG}/${PLACEHOLDER}/${unowned}`],
            },
          },
        })
      );
      expect(removeFilesAtPaths).toHaveBeenCalledWith({
        paths: [`${ORG}/${PLACEHOLDER}/${unowned}`],
        bucketName: "assets",
      });
    });

    it("sends no removal when the folder is empty", async () => {
      await clearStagedAssetAttachment({
        placeholderId: PLACEHOLDER,
        organizationId: ORG,
      });

      expect(removeFilesAtPaths).not.toHaveBeenCalled();
    });

    it("refuses a placeholder id that is a dot segment", async () => {
      await expect(
        clearStagedAssetAttachment({ placeholderId: "..", organizationId: ORG })
      ).rejects.toMatchObject({ status: 400 });

      expect(listFilesInFolder).not.toHaveBeenCalled();
      expect(removeFilesAtPaths).not.toHaveBeenCalled();
    });
  });

  describe("removeAttachmentFilesOfDeletedAssets", () => {
    it("removes the stored paths of the deleted assets that had one", async () => {
      await removeAttachmentFilesOfDeletedAssets({
        attachmentPaths: [STAGED_PATH, null, undefined],
        organizationId: ORG,
      });

      expect(removeFilesAtPaths).toHaveBeenCalledWith({
        paths: [STAGED_PATH],
        bucketName: "assets",
      });
    });

    it("sends no request when no deleted asset had an attachment", async () => {
      await removeAttachmentFilesOfDeletedAssets({
        attachmentPaths: [null],
        organizationId: ORG,
      });

      expect(removeFilesAtPaths).not.toHaveBeenCalled();
    });

    it("logs and resolves when Storage refuses", async () => {
      vi.mocked(removeFilesAtPaths).mockRejectedValue(new Error("Bad gateway"));

      await expect(
        removeAttachmentFilesOfDeletedAssets({
          attachmentPaths: [STAGED_PATH],
          organizationId: ORG,
        })
      ).resolves.toBeUndefined();
      expect(loggerErrorSpy).toHaveBeenCalledTimes(1);
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

  describe("findStagedAttachmentPath", () => {
    it("returns the newest attachment in the placeholder folder", async () => {
      const older = FILE_NAME.replace("1760000000", "1750000000");
      vi.mocked(listFilesInFolder).mockResolvedValue([
        { name: older, size: 1 },
        { name: FILE_NAME, size: 2 },
        { name: "notes.txt", size: 3 },
      ]);

      await expect(
        findStagedAttachmentPath({
          placeholderId: PLACEHOLDER,
          organizationId: ORG,
        })
      ).resolves.toBe(STAGED_PATH);
      expect(listFilesInFolder).toHaveBeenCalledWith({
        folder: `${ORG}/${PLACEHOLDER}`,
        bucketName: "assets",
      });
    });

    it("returns null when nothing is staged", async () => {
      vi.mocked(listFilesInFolder).mockResolvedValue([]);

      await expect(
        findStagedAttachmentPath({
          placeholderId: PLACEHOLDER,
          organizationId: ORG,
        })
      ).resolves.toBeNull();
    });

    it("refuses a placeholder id that would leave the workspace folder", async () => {
      await expect(
        findStagedAttachmentPath({ placeholderId: "..", organizationId: ORG })
      ).rejects.toMatchObject({ status: 400 });

      expect(listFilesInFolder).not.toHaveBeenCalled();
    });
  });

  describe("signAttachmentForViewing", () => {
    it("signs the path for one minute, not the 72-hour image default", async () => {
      await signAttachmentForViewing(STAGED_PATH);

      expect(ATTACHMENT_LINK_TTL_SECONDS).toBe(60);
      expect(createSignedUrl).toHaveBeenCalledWith({
        filename: STAGED_PATH,
        bucketName: "assets",
        expiresIn: 60,
      });
    });
  });
});
