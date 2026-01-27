import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock the database
vi.mock("~/database/db.server", () => ({
  // why: We need to mock database operations to avoid hitting the real database during tests
  db: {
    note: {
      create: vi.fn(),
      createMany: vi.fn(),
      deleteMany: vi.fn(),
    },
    user: {
      findFirstOrThrow: vi.fn(),
      findUnique: vi.fn(),
    },
  },
}));

// Mock helper functions
vi.mock("~/modules/note/helpers.server", () => ({
  // why: Helper functions are tested separately, we just need them to return predictable values
  buildCategoryChangeNote: vi.fn(),
  buildDescriptionChangeNote: vi.fn(),
  buildNameChangeNote: vi.fn(),
  buildValuationChangeNote: vi.fn(),
  resolveUserLink: vi.fn(),
}));

vi.mock("~/utils/markdoc-wrappers", () => ({
  // why: These are formatting utilities, we just need them to return formatted strings
  wrapKitsWithDataForNote: vi.fn((kit) => `kit:${kit?.name || "unknown"}`),
  wrapUserLinkForNote: vi.fn((user) => `@${user.firstName}`),
  wrapTagForNote: vi.fn((tag) => `#${tag.name}`),
  wrapLinkForNote: vi.fn((to, text) => `[${text}](${to})`),
}));

import { db } from "~/database/db.server";
import {
  buildCategoryChangeNote,
  buildDescriptionChangeNote,
  buildNameChangeNote,
  buildValuationChangeNote,
  resolveUserLink,
} from "~/modules/note/helpers.server";
import { ShelfError } from "~/utils/error";

import {
  createAssetCategoryChangeNote,
  createAssetDescriptionChangeNote,
  createAssetNameChangeNote,
  createAssetNotesForAuditAddition,
  createAssetNotesForAuditRemoval,
  createAssetValuationChangeNote,
  createBulkKitChangeNotes,
  createNote,
  createNotes,
  deleteNote,
} from "./service.server";

describe("note service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset note.create to successful state by default
    vi.mocked(db.note.create).mockResolvedValue({
      id: "note-1",
      content: "Test note",
      type: "UPDATE",
      userId: "user-1",
      assetId: "asset-1",
      createdAt: new Date(),
      updatedAt: new Date(),
    } as any);
  });

  describe("createNote", () => {
    it("creates a single note with COMMENT type by default", async () => {
      const mockNote = {
        id: "note-1",
        content: "This is a test note",
        type: "COMMENT",
        userId: "user-1",
        assetId: "asset-1",
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      vi.mocked(db.note.create).mockResolvedValue(mockNote as any);

      const result = await createNote({
        content: "This is a test note",
        userId: "user-1",
        assetId: "asset-1",
      });

      expect(db.note.create).toHaveBeenCalledWith({
        data: {
          content: "This is a test note",
          type: "COMMENT",
          user: {
            connect: {
              id: "user-1",
            },
          },
          asset: {
            connect: {
              id: "asset-1",
            },
          },
        },
      });

      expect(result).toEqual(mockNote);
    });

    it("creates a note with UPDATE type when specified", async () => {
      const mockNote = {
        id: "note-1",
        content: "Asset was updated",
        type: "UPDATE",
        userId: "user-1",
        assetId: "asset-1",
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      vi.mocked(db.note.create).mockResolvedValue(mockNote as any);

      await createNote({
        content: "Asset was updated",
        type: "UPDATE",
        userId: "user-1",
        assetId: "asset-1",
      });

      expect(db.note.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            type: "UPDATE",
          }),
        })
      );
    });

    it("throws ShelfError when database operation fails", async () => {
      vi.mocked(db.note.create).mockRejectedValue(
        new Error("Database connection failed")
      );

      await expect(
        createNote({
          content: "Test note",
          userId: "user-1",
          assetId: "asset-1",
        })
      ).rejects.toThrow(ShelfError);

      await expect(
        createNote({
          content: "Test note",
          userId: "user-1",
          assetId: "asset-1",
        })
      ).rejects.toThrow("Something went wrong while creating a note");
    });
  });

  describe("createNotes", () => {
    it("creates multiple notes with the same content", async () => {
      vi.mocked(db.note.createMany).mockResolvedValue({ count: 3 });

      const result = await createNotes({
        content: "Bulk operation note",
        userId: "user-1",
        assetIds: ["asset-1", "asset-2", "asset-3"],
      });

      expect(db.note.createMany).toHaveBeenCalledWith({
        data: [
          {
            content: "Bulk operation note",
            type: "COMMENT",
            userId: "user-1",
            assetId: "asset-1",
          },
          {
            content: "Bulk operation note",
            type: "COMMENT",
            userId: "user-1",
            assetId: "asset-2",
          },
          {
            content: "Bulk operation note",
            type: "COMMENT",
            userId: "user-1",
            assetId: "asset-3",
          },
        ],
      });

      expect(result.count).toBe(3);
    });

    it("creates notes with UPDATE type when specified", async () => {
      vi.mocked(db.note.createMany).mockResolvedValue({ count: 2 });

      await createNotes({
        content: "Bulk update note",
        type: "UPDATE",
        userId: "user-1",
        assetIds: ["asset-1", "asset-2"],
      });

      expect(db.note.createMany).toHaveBeenCalledWith({
        data: expect.arrayContaining([
          expect.objectContaining({ type: "UPDATE" }),
          expect.objectContaining({ type: "UPDATE" }),
        ]),
      });
    });

    it("handles empty asset IDs array", async () => {
      vi.mocked(db.note.createMany).mockResolvedValue({ count: 0 });

      const result = await createNotes({
        content: "Test note",
        userId: "user-1",
        assetIds: [],
      });

      expect(db.note.createMany).toHaveBeenCalledWith({
        data: [],
      });

      expect(result.count).toBe(0);
    });

    it("throws ShelfError when database operation fails", async () => {
      vi.mocked(db.note.createMany).mockRejectedValue(
        new Error("Database timeout")
      );

      await expect(
        createNotes({
          content: "Test note",
          userId: "user-1",
          assetIds: ["asset-1"],
        })
      ).rejects.toThrow(ShelfError);

      await expect(
        createNotes({
          content: "Test note",
          userId: "user-1",
          assetIds: ["asset-1"],
        })
      ).rejects.toThrow("Something went wrong while creating notes");
    });
  });

  describe("deleteNote", () => {
    it("deletes a note for a specific user", async () => {
      vi.mocked(db.note.deleteMany).mockResolvedValue({ count: 1 });

      const result = await deleteNote({
        id: "note-1",
        userId: "user-1",
      });

      expect(db.note.deleteMany).toHaveBeenCalledWith({
        where: {
          id: "note-1",
          userId: "user-1",
        },
      });

      expect(result.count).toBe(1);
    });

    it("returns count of 0 when note doesn't exist or user doesn't own it", async () => {
      vi.mocked(db.note.deleteMany).mockResolvedValue({ count: 0 });

      const result = await deleteNote({
        id: "nonexistent-note",
        userId: "user-1",
      });

      expect(result.count).toBe(0);
    });

    it("throws ShelfError when database operation fails", async () => {
      vi.mocked(db.note.deleteMany).mockRejectedValue(
        new Error("Database error")
      );

      await expect(
        deleteNote({
          id: "note-1",
          userId: "user-1",
        })
      ).rejects.toThrow(ShelfError);

      await expect(
        deleteNote({
          id: "note-1",
          userId: "user-1",
        })
      ).rejects.toThrow("Something went wrong while deleting the note");
    });
  });

  describe("createBulkKitChangeNotes", () => {
    it("creates notes for newly added assets to kit", async () => {
      vi.mocked(db.user.findFirstOrThrow).mockResolvedValue({
        firstName: "John",
        lastName: "Doe",
      } as any);
      vi.mocked(db.note.createMany).mockResolvedValue({ count: 2 });

      const kit = {
        id: "kit-1",
        name: "Camera Kit",
      };

      const result = await createBulkKitChangeNotes({
        newlyAddedAssets: [
          { id: "asset-1", title: "Camera", kit: null } as any,
          { id: "asset-2", title: "Lens", kit: null } as any,
        ],
        removedAssets: [],
        userId: "user-1",
        kit: kit as any,
      });

      // Expect db.note.create to be called twice (once for each asset)
      expect(db.note.create).toHaveBeenCalledTimes(2);

      // Verify the first call has correct structure
      const firstCall = vi.mocked(db.note.create).mock.calls[0][0];
      expect(firstCall.data.type).toBe("UPDATE");
      expect(firstCall.data.content).toContain("added");
      expect(firstCall.data.asset?.connect?.id).toBe("asset-1");
      expect(firstCall.data.user?.connect?.id).toBe("user-1");

      expect(result).toBeUndefined();
    });

    it("creates notes for assets removed from kit", async () => {
      vi.mocked(db.user.findFirstOrThrow).mockResolvedValue({
        firstName: "John",
        lastName: "Doe",
      } as any);
      vi.mocked(db.note.createMany).mockResolvedValue({ count: 1 });

      const kit = {
        id: "kit-1",
        name: "Camera Kit",
      };

      await createBulkKitChangeNotes({
        newlyAddedAssets: [],
        removedAssets: [{ id: "asset-3", title: "Tripod", kit: kit as any }],
        userId: "user-1",
        kit: kit as any,
      });

      // Expect db.note.create to be called once for the removed asset
      expect(db.note.create).toHaveBeenCalledTimes(1);

      // Verify the call has correct structure
      const call = vi.mocked(db.note.create).mock.calls[0][0];
      expect(call.data.type).toBe("UPDATE");
      expect(call.data.content).toContain("removed asset from");
      expect(call.data.asset?.connect?.id).toBe("asset-3");
      expect(call.data.user?.connect?.id).toBe("user-1");
    });

    it("creates notes for both added and removed assets", async () => {
      vi.mocked(db.user.findFirstOrThrow).mockResolvedValue({
        firstName: "John",
        lastName: "Doe",
      } as any);
      vi.mocked(db.note.createMany).mockResolvedValue({ count: 3 });

      const kit = {
        id: "kit-1",
        name: "Camera Kit",
      };

      await createBulkKitChangeNotes({
        newlyAddedAssets: [
          { id: "asset-1", title: "Camera", kit: null } as any,
          { id: "asset-2", title: "Lens", kit: null } as any,
        ],
        removedAssets: [{ id: "asset-3", title: "Tripod", kit: kit as any }],
        userId: "user-1",
        kit: kit as any,
      });

      // Expect db.note.create to be called 3 times (2 added + 1 removed)
      expect(db.note.create).toHaveBeenCalledTimes(3);
    });

    it("does nothing when no assets are added or removed", async () => {
      vi.mocked(db.user.findFirstOrThrow).mockResolvedValue({
        firstName: "John",
        lastName: "Doe",
      } as any);
      const kit = {
        id: "kit-1",
        name: "Camera Kit",
      };

      await createBulkKitChangeNotes({
        newlyAddedAssets: [],
        removedAssets: [],
        userId: "user-1",
        kit: kit as any,
      });

      // Should not create any notes
      expect(db.note.create).not.toHaveBeenCalled();
    });
  });

  describe("createAssetNameChangeNote", () => {
    const mockLoadUserForNotes = vi.fn().mockResolvedValue({
      firstName: "John",
      lastName: "Doe",
    });

    it("creates note when name is changed", async () => {
      vi.mocked(resolveUserLink).mockResolvedValue("@John");
      vi.mocked(buildNameChangeNote).mockReturnValue(
        "@John updated the asset name from **Old Name** to **New Name**."
      );
      vi.mocked(db.note.create).mockResolvedValue({} as any);

      await createAssetNameChangeNote({
        assetId: "asset-1",
        userId: "user-1",
        previousName: "Old Name",
        newName: "New Name",
        loadUserForNotes: mockLoadUserForNotes,
      });

      expect(resolveUserLink).toHaveBeenCalledWith({
        userId: "user-1",
        loadUserForNotes: mockLoadUserForNotes,
      });

      expect(buildNameChangeNote).toHaveBeenCalledWith({
        userLink: "@John",
        previous: "Old Name",
        next: "New Name",
      });

      expect(db.note.create).toHaveBeenCalledWith({
        data: {
          content:
            "@John updated the asset name from **Old Name** to **New Name**.",
          type: "UPDATE",
          user: {
            connect: {
              id: "user-1",
            },
          },
          asset: {
            connect: {
              id: "asset-1",
            },
          },
        },
      });
    });

    it("does not create note when buildNameChangeNote returns null", async () => {
      vi.mocked(resolveUserLink).mockResolvedValue("@John");
      vi.mocked(buildNameChangeNote).mockReturnValue(null);

      await createAssetNameChangeNote({
        assetId: "asset-1",
        userId: "user-1",
        previousName: "Same Name",
        newName: "Same Name",
        loadUserForNotes: mockLoadUserForNotes,
      });

      expect(db.note.create).not.toHaveBeenCalled();
    });
  });

  describe("createAssetDescriptionChangeNote", () => {
    const mockLoadUserForNotes = vi.fn().mockResolvedValue({
      firstName: "Jane",
      lastName: "Smith",
    });

    it("creates note when description is added", async () => {
      vi.mocked(resolveUserLink).mockResolvedValue("@Jane");
      vi.mocked(buildDescriptionChangeNote).mockReturnValue(
        "@Jane added an asset description."
      );
      vi.mocked(db.note.create).mockResolvedValue({} as any);

      await createAssetDescriptionChangeNote({
        assetId: "asset-1",
        userId: "user-1",
        previousDescription: null,
        newDescription: "New description",
        loadUserForNotes: mockLoadUserForNotes,
      });

      expect(db.note.create).toHaveBeenCalled();
    });

    it("creates note when description is removed", async () => {
      vi.mocked(resolveUserLink).mockResolvedValue("@Jane");
      vi.mocked(buildDescriptionChangeNote).mockReturnValue(
        "@Jane removed the asset description."
      );
      vi.mocked(db.note.create).mockResolvedValue({} as any);

      await createAssetDescriptionChangeNote({
        assetId: "asset-1",
        userId: "user-1",
        previousDescription: "Old description",
        newDescription: null,
        loadUserForNotes: mockLoadUserForNotes,
      });

      expect(db.note.create).toHaveBeenCalled();
    });

    it("does not create note when description is unchanged", async () => {
      vi.mocked(resolveUserLink).mockResolvedValue("@Jane");
      vi.mocked(buildDescriptionChangeNote).mockReturnValue(null);

      await createAssetDescriptionChangeNote({
        assetId: "asset-1",
        userId: "user-1",
        previousDescription: "Same description",
        newDescription: "Same description",
        loadUserForNotes: mockLoadUserForNotes,
      });

      expect(db.note.create).not.toHaveBeenCalled();
    });
  });

  describe("createAssetCategoryChangeNote", () => {
    const mockLoadUserForNotes = vi.fn().mockResolvedValue({
      firstName: "Bob",
      lastName: "Johnson",
    });

    it("creates note when category is changed", async () => {
      vi.mocked(resolveUserLink).mockResolvedValue("@Bob");
      vi.mocked(buildCategoryChangeNote).mockReturnValue(
        "@Bob changed the asset category from Electronics to Furniture."
      );
      vi.mocked(db.note.create).mockResolvedValue({} as any);

      await createAssetCategoryChangeNote({
        assetId: "asset-1",
        userId: "user-1",
        previousCategory: {
          id: "cat-1",
          name: "Electronics",
          color: "#FF0000",
        },
        newCategory: { id: "cat-2", name: "Furniture", color: "#00FF00" },
        loadUserForNotes: mockLoadUserForNotes,
      });

      expect(buildCategoryChangeNote).toHaveBeenCalledWith({
        userLink: "@Bob",
        previous: { id: "cat-1", name: "Electronics", color: "#FF0000" },
        next: { id: "cat-2", name: "Furniture", color: "#00FF00" },
      });

      expect(db.note.create).toHaveBeenCalled();
    });

    it("creates note when category is added", async () => {
      vi.mocked(resolveUserLink).mockResolvedValue("@Bob");
      vi.mocked(buildCategoryChangeNote).mockReturnValue(
        "@Bob set the asset category to Electronics."
      );
      vi.mocked(db.note.create).mockResolvedValue({} as any);

      await createAssetCategoryChangeNote({
        assetId: "asset-1",
        userId: "user-1",
        previousCategory: null,
        newCategory: { id: "cat-1", name: "Electronics", color: "#FF0000" },
        loadUserForNotes: mockLoadUserForNotes,
      });

      expect(db.note.create).toHaveBeenCalled();
    });

    it("does not create note when category is unchanged", async () => {
      vi.mocked(resolveUserLink).mockResolvedValue("@Bob");
      vi.mocked(buildCategoryChangeNote).mockReturnValue(null);

      await createAssetCategoryChangeNote({
        assetId: "asset-1",
        userId: "user-1",
        previousCategory: {
          id: "cat-1",
          name: "Electronics",
          color: "#FF0000",
        },
        newCategory: { id: "cat-1", name: "Electronics", color: "#FF0000" },
        loadUserForNotes: mockLoadUserForNotes,
      });

      expect(db.note.create).not.toHaveBeenCalled();
    });
  });

  describe("createAssetValuationChangeNote", () => {
    const mockLoadUserForNotes = vi.fn().mockResolvedValue({
      firstName: "Alice",
      lastName: "Williams",
    });

    it("creates note when valuation is changed", async () => {
      vi.mocked(resolveUserLink).mockResolvedValue("@Alice");
      vi.mocked(buildValuationChangeNote).mockReturnValue(
        "@Alice changed the asset value from $100.00 to $150.00."
      );
      vi.mocked(db.note.create).mockResolvedValue({} as any);

      await createAssetValuationChangeNote({
        assetId: "asset-1",
        userId: "user-1",
        previousValuation: 100,
        newValuation: 150,
        currency: "USD" as any,
        locale: "en-US",
        loadUserForNotes: mockLoadUserForNotes,
      });

      expect(buildValuationChangeNote).toHaveBeenCalledWith({
        userLink: "@Alice",
        previous: 100,
        next: 150,
        currency: "USD",
        locale: "en-US",
      });

      expect(db.note.create).toHaveBeenCalled();
    });

    it("creates note when valuation is set for the first time", async () => {
      vi.mocked(resolveUserLink).mockResolvedValue("@Alice");
      vi.mocked(buildValuationChangeNote).mockReturnValue(
        "@Alice set the asset value to $200.00."
      );
      vi.mocked(db.note.create).mockResolvedValue({} as any);

      await createAssetValuationChangeNote({
        assetId: "asset-1",
        userId: "user-1",
        previousValuation: null,
        newValuation: 200,
        currency: "USD" as any,
        locale: "en-US",
        loadUserForNotes: mockLoadUserForNotes,
      });

      expect(db.note.create).toHaveBeenCalled();
    });

    it("does not create note when valuation is unchanged", async () => {
      vi.mocked(resolveUserLink).mockResolvedValue("@Alice");
      vi.mocked(buildValuationChangeNote).mockReturnValue(null);

      await createAssetValuationChangeNote({
        assetId: "asset-1",
        userId: "user-1",
        previousValuation: 100,
        newValuation: 100,
        currency: "USD" as any,
        locale: "en-US",
        loadUserForNotes: mockLoadUserForNotes,
      });

      expect(db.note.create).not.toHaveBeenCalled();
    });
  });

  describe("createAssetNotesForAuditAddition", () => {
    it("creates notes for assets added to audit", async () => {
      vi.mocked(db.user.findUnique).mockResolvedValue({
        id: "user-1",
        firstName: "John",
        lastName: "Doe",
      } as any);
      vi.mocked(db.note.createMany).mockResolvedValue({ count: 3 });

      const audit = {
        id: "audit-1",
        name: "Q1 Audit",
      };

      await createAssetNotesForAuditAddition({
        assetIds: ["asset-1", "asset-2", "asset-3"],
        userId: "user-1",
        audit,
      });

      expect(db.user.findUnique).toHaveBeenCalledWith({
        where: { id: "user-1" },
        select: { id: true, firstName: true, lastName: true },
      });

      expect(db.note.createMany).toHaveBeenCalledWith({
        data: [
          {
            content:
              "@John added asset to audit [Q1 Audit](/audits/audit-1/overview).",
            type: "UPDATE",
            userId: "user-1",
            assetId: "asset-1",
          },
          {
            content:
              "@John added asset to audit [Q1 Audit](/audits/audit-1/overview).",
            type: "UPDATE",
            userId: "user-1",
            assetId: "asset-2",
          },
          {
            content:
              "@John added asset to audit [Q1 Audit](/audits/audit-1/overview).",
            type: "UPDATE",
            userId: "user-1",
            assetId: "asset-3",
          },
        ],
      });
    });

    it("does not create notes when user is not found", async () => {
      vi.mocked(db.user.findUnique).mockResolvedValue(null);

      const audit = {
        id: "audit-1",
        name: "Q1 Audit",
      };

      await createAssetNotesForAuditAddition({
        assetIds: ["asset-1"],
        userId: "nonexistent-user",
        audit,
      });

      expect(db.note.createMany).not.toHaveBeenCalled();
    });

    it("does not create notes when assetIds array is empty", async () => {
      vi.mocked(db.user.findUnique).mockResolvedValue({
        id: "user-1",
        firstName: "John",
        lastName: "Doe",
      } as any);

      const audit = {
        id: "audit-1",
        name: "Q1 Audit",
      };

      await createAssetNotesForAuditAddition({
        assetIds: [],
        userId: "user-1",
        audit,
      });

      expect(db.note.createMany).not.toHaveBeenCalled();
    });

    it("throws ShelfError when database operation fails", async () => {
      vi.mocked(db.user.findUnique).mockRejectedValue(
        new Error("Database error")
      );

      const audit = {
        id: "audit-1",
        name: "Q1 Audit",
      };

      await expect(
        createAssetNotesForAuditAddition({
          assetIds: ["asset-1"],
          userId: "user-1",
          audit,
        })
      ).rejects.toThrow(ShelfError);

      await expect(
        createAssetNotesForAuditAddition({
          assetIds: ["asset-1"],
          userId: "user-1",
          audit,
        })
      ).rejects.toThrow(
        "Something went wrong while creating asset notes for audit addition"
      );
    });
  });

  describe("createAssetNotesForAuditRemoval", () => {
    it("creates notes for assets removed from audit", async () => {
      vi.mocked(db.user.findUnique).mockResolvedValue({
        id: "user-1",
        firstName: "Jane",
        lastName: "Smith",
      } as any);
      vi.mocked(db.note.createMany).mockResolvedValue({ count: 2 });

      const audit = {
        id: "audit-1",
        name: "Q1 Audit",
      };

      await createAssetNotesForAuditRemoval({
        assetIds: ["asset-1", "asset-2"],
        userId: "user-1",
        audit,
      });

      expect(db.user.findUnique).toHaveBeenCalledWith({
        where: { id: "user-1" },
        select: { id: true, firstName: true, lastName: true },
      });

      expect(db.note.createMany).toHaveBeenCalledWith({
        data: [
          {
            content:
              "@Jane removed asset from audit [Q1 Audit](/audits/audit-1/overview).",
            type: "UPDATE",
            userId: "user-1",
            assetId: "asset-1",
          },
          {
            content:
              "@Jane removed asset from audit [Q1 Audit](/audits/audit-1/overview).",
            type: "UPDATE",
            userId: "user-1",
            assetId: "asset-2",
          },
        ],
      });
    });

    it("does not create notes when user is not found", async () => {
      vi.mocked(db.user.findUnique).mockResolvedValue(null);

      const audit = {
        id: "audit-1",
        name: "Q1 Audit",
      };

      await createAssetNotesForAuditRemoval({
        assetIds: ["asset-1"],
        userId: "nonexistent-user",
        audit,
      });

      expect(db.note.createMany).not.toHaveBeenCalled();
    });

    it("does not create notes when assetIds array is empty", async () => {
      vi.mocked(db.user.findUnique).mockResolvedValue({
        id: "user-1",
        firstName: "Jane",
        lastName: "Smith",
      } as any);

      const audit = {
        id: "audit-1",
        name: "Q1 Audit",
      };

      await createAssetNotesForAuditRemoval({
        assetIds: [],
        userId: "user-1",
        audit,
      });

      expect(db.note.createMany).not.toHaveBeenCalled();
    });

    it("throws ShelfError when database operation fails", async () => {
      vi.mocked(db.user.findUnique).mockRejectedValue(
        new Error("Database error")
      );

      const audit = {
        id: "audit-1",
        name: "Q1 Audit",
      };

      await expect(
        createAssetNotesForAuditRemoval({
          assetIds: ["asset-1"],
          userId: "user-1",
          audit,
        })
      ).rejects.toThrow(ShelfError);

      await expect(
        createAssetNotesForAuditRemoval({
          assetIds: ["asset-1"],
          userId: "user-1",
          audit,
        })
      ).rejects.toThrow(
        "Something went wrong while creating asset notes for audit removal"
      );
    });
  });
});
