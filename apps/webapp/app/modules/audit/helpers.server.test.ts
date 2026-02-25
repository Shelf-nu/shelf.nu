import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  createAssetScanNote,
  createAuditCreationNote,
  createAuditStartedNote,
  createAuditCompletedNote,
  createAuditAssetImagesAddedNote,
  createAssetsAddedToAuditNote,
  createAssetRemovedFromAuditNote,
  createAssetsRemovedFromAuditNote,
} from "./helpers.server";

// Mock the markdoc wrappers
vi.mock("~/utils/markdoc-wrappers", () => ({
  // why: We need to mock the markdoc wrapper functions to avoid complex template rendering in tests
  wrapUserLinkForNote: vi.fn(
    (user: {
      id: string;
      firstName?: string | null;
      lastName?: string | null;
    }) =>
      `{% link to="/settings/team/users/${user.id}" text="${user.firstName} ${user.lastName}" /%}`
  ),
  wrapAssetsWithDataForNote: vi.fn(
    (asset: { id: string; title: string }) =>
      `{% link to="/assets/${asset.id}" text="${asset.title}" /%}`
  ),
}));

describe("audit helpers", () => {
  describe("createAuditCreationNote", () => {
    let mockTx: any;

    beforeEach(() => {
      mockTx = {
        user: {
          findUnique: vi.fn(),
        },
        auditNote: {
          create: vi.fn(),
        },
        auditImage: {
          findMany: vi.fn().mockResolvedValue([]),
        },
      };
    });

    it("creates a note when audit is created with single asset", async () => {
      mockTx.user.findUnique.mockResolvedValue({
        id: "user-1",
        firstName: "John",
        lastName: "Doe",
      });

      await createAuditCreationNote({
        auditSessionId: "audit-1",
        createdById: "user-1",
        expectedAssetCount: 1,
        tx: mockTx,
      });

      expect(mockTx.user.findUnique).toHaveBeenCalledWith({
        where: { id: "user-1" },
        select: {
          id: true,
          firstName: true,
          lastName: true,
        },
      });

      expect(mockTx.auditNote.create).toHaveBeenCalledWith({
        data: {
          auditSessionId: "audit-1",
          userId: "user-1",
          type: "UPDATE",
          content: expect.stringContaining(
            "created audit with **1** expected asset."
          ),
        },
      });
    });

    it("creates a note with plural assets", async () => {
      mockTx.user.findUnique.mockResolvedValue({
        id: "user-2",
        firstName: "Jane",
        lastName: "Smith",
      });

      await createAuditCreationNote({
        auditSessionId: "audit-2",
        createdById: "user-2",
        expectedAssetCount: 5,
        tx: mockTx,
      });

      expect(mockTx.auditNote.create).toHaveBeenCalledWith({
        data: {
          auditSessionId: "audit-2",
          userId: "user-2",
          type: "UPDATE",
          content: expect.stringContaining(
            "created audit with **5** expected assets."
          ),
        },
      });
    });

    it("includes user link in note content", async () => {
      mockTx.user.findUnique.mockResolvedValue({
        id: "user-3",
        firstName: "Alice",
        lastName: "Johnson",
      });

      await createAuditCreationNote({
        auditSessionId: "audit-3",
        createdById: "user-3",
        expectedAssetCount: 10,
        tx: mockTx,
      });

      const createCall = mockTx.auditNote.create.mock.calls[0][0];
      expect(createCall.data.content).toContain(
        '{% link to="/settings/team/users/user-3"'
      );
      expect(createCall.data.content).toContain('text="Alice Johnson"');
    });

    it("skips note creation when user not found", async () => {
      mockTx.user.findUnique.mockResolvedValue(null);

      await createAuditCreationNote({
        auditSessionId: "audit-4",
        createdById: "nonexistent-user",
        expectedAssetCount: 3,
        tx: mockTx,
      });

      expect(mockTx.user.findUnique).toHaveBeenCalled();
      expect(mockTx.auditNote.create).not.toHaveBeenCalled();
    });

    it("handles user with null first/last name", async () => {
      mockTx.user.findUnique.mockResolvedValue({
        id: "user-5",
        firstName: null,
        lastName: null,
      });

      await createAuditCreationNote({
        auditSessionId: "audit-5",
        createdById: "user-5",
        expectedAssetCount: 2,
        tx: mockTx,
      });

      expect(mockTx.auditNote.create).toHaveBeenCalled();
    });
  });

  describe("createAssetScanNote", () => {
    let mockTx: any;

    beforeEach(() => {
      mockTx = {
        asset: {
          findUnique: vi.fn(),
        },
        user: {
          findUnique: vi.fn(),
        },
        auditNote: {
          create: vi.fn(),
        },
      };
    });

    it("creates a note for expected asset scan", async () => {
      mockTx.asset.findUnique.mockResolvedValue({
        id: "asset-1",
        title: "Camera A",
      });
      mockTx.user.findUnique.mockResolvedValue({
        id: "user-1",
        firstName: "John",
        lastName: "Doe",
      });

      await createAssetScanNote({
        auditSessionId: "audit-1",
        assetId: "asset-1",
        userId: "user-1",
        isExpected: true,
        tx: mockTx,
      });

      expect(mockTx.asset.findUnique).toHaveBeenCalledWith({
        where: { id: "asset-1" },
        select: { id: true, title: true },
      });

      expect(mockTx.user.findUnique).toHaveBeenCalledWith({
        where: { id: "user-1" },
        select: {
          id: true,
          firstName: true,
          lastName: true,
        },
      });

      expect(mockTx.auditNote.create).toHaveBeenCalledWith({
        data: {
          auditSessionId: "audit-1",
          userId: "user-1",
          type: "UPDATE",
          content: expect.stringContaining("scanned expected asset"),
        },
      });
    });

    it("creates a note for unexpected asset scan", async () => {
      mockTx.asset.findUnique.mockResolvedValue({
        id: "asset-2",
        title: "Laptop B",
      });
      mockTx.user.findUnique.mockResolvedValue({
        id: "user-2",
        firstName: "Jane",
        lastName: "Smith",
      });

      await createAssetScanNote({
        auditSessionId: "audit-2",
        assetId: "asset-2",
        userId: "user-2",
        isExpected: false,
        tx: mockTx,
      });

      expect(mockTx.auditNote.create).toHaveBeenCalledWith({
        data: {
          auditSessionId: "audit-2",
          userId: "user-2",
          type: "UPDATE",
          content: expect.stringContaining("scanned unexpected asset"),
        },
      });
    });

    it("includes asset link in note content", async () => {
      mockTx.asset.findUnique.mockResolvedValue({
        id: "asset-3",
        title: "Monitor C",
      });
      mockTx.user.findUnique.mockResolvedValue({
        id: "user-3",
        firstName: "Bob",
        lastName: "Wilson",
      });

      await createAssetScanNote({
        auditSessionId: "audit-3",
        assetId: "asset-3",
        userId: "user-3",
        isExpected: true,
        tx: mockTx,
      });

      const createCall = mockTx.auditNote.create.mock.calls[0][0];
      expect(createCall.data.content).toContain('{% link to="/assets/asset-3"');
      expect(createCall.data.content).toContain('text="Monitor C"');
    });

    it("fetches asset and user in parallel", async () => {
      mockTx.asset.findUnique.mockResolvedValue({
        id: "asset-4",
        title: "Keyboard D",
      });
      mockTx.user.findUnique.mockResolvedValue({
        id: "user-4",
        firstName: "Carol",
        lastName: "Davis",
      });

      await createAssetScanNote({
        auditSessionId: "audit-4",
        assetId: "asset-4",
        userId: "user-4",
        isExpected: true,
        tx: mockTx,
      });

      // Both queries should have been called
      expect(mockTx.asset.findUnique).toHaveBeenCalled();
      expect(mockTx.user.findUnique).toHaveBeenCalled();
      expect(mockTx.auditNote.create).toHaveBeenCalled();
    });

    it("skips note creation when asset not found", async () => {
      mockTx.asset.findUnique.mockResolvedValue(null);
      mockTx.user.findUnique.mockResolvedValue({
        id: "user-5",
        firstName: "Dave",
        lastName: "Brown",
      });

      await createAssetScanNote({
        auditSessionId: "audit-5",
        assetId: "nonexistent-asset",
        userId: "user-5",
        isExpected: true,
        tx: mockTx,
      });

      expect(mockTx.asset.findUnique).toHaveBeenCalled();
      expect(mockTx.auditNote.create).not.toHaveBeenCalled();
    });

    it("skips note creation when user not found", async () => {
      mockTx.asset.findUnique.mockResolvedValue({
        id: "asset-6",
        title: "Mouse E",
      });
      mockTx.user.findUnique.mockResolvedValue(null);

      await createAssetScanNote({
        auditSessionId: "audit-6",
        assetId: "asset-6",
        userId: "nonexistent-user",
        isExpected: true,
        tx: mockTx,
      });

      expect(mockTx.user.findUnique).toHaveBeenCalled();
      expect(mockTx.auditNote.create).not.toHaveBeenCalled();
    });

    it("skips note creation when both asset and user not found", async () => {
      mockTx.asset.findUnique.mockResolvedValue(null);
      mockTx.user.findUnique.mockResolvedValue(null);

      await createAssetScanNote({
        auditSessionId: "audit-7",
        assetId: "nonexistent-asset",
        userId: "nonexistent-user",
        isExpected: false,
        tx: mockTx,
      });

      expect(mockTx.auditNote.create).not.toHaveBeenCalled();
    });
  });

  describe("createAuditStartedNote", () => {
    let mockTx: any;

    beforeEach(() => {
      mockTx = {
        user: {
          findUnique: vi.fn(),
        },
        auditNote: {
          create: vi.fn(),
        },
      };
    });

    it("creates a note when audit is started", async () => {
      mockTx.user.findUnique.mockResolvedValue({
        id: "user-1",
        firstName: "John",
        lastName: "Doe",
      });

      await createAuditStartedNote({
        auditSessionId: "audit-1",
        userId: "user-1",
        tx: mockTx,
      });

      expect(mockTx.user.findUnique).toHaveBeenCalledWith({
        where: { id: "user-1" },
        select: {
          id: true,
          firstName: true,
          lastName: true,
        },
      });

      expect(mockTx.auditNote.create).toHaveBeenCalledWith({
        data: {
          auditSessionId: "audit-1",
          userId: "user-1",
          type: "UPDATE",
          content: expect.stringContaining("started the audit"),
        },
      });
    });

    it("includes user link in note content", async () => {
      mockTx.user.findUnique.mockResolvedValue({
        id: "user-2",
        firstName: "Jane",
        lastName: "Smith",
      });

      await createAuditStartedNote({
        auditSessionId: "audit-2",
        userId: "user-2",
        tx: mockTx,
      });

      const createCall = mockTx.auditNote.create.mock.calls[0][0];
      expect(createCall.data.content).toContain(
        '{% link to="/settings/team/users/user-2"'
      );
      expect(createCall.data.content).toContain('text="Jane Smith"');
    });

    it("skips note creation when user not found", async () => {
      mockTx.user.findUnique.mockResolvedValue(null);

      await createAuditStartedNote({
        auditSessionId: "audit-3",
        userId: "nonexistent-user",
        tx: mockTx,
      });

      expect(mockTx.user.findUnique).toHaveBeenCalled();
      expect(mockTx.auditNote.create).not.toHaveBeenCalled();
    });
  });

  describe("createAuditCompletedNote", () => {
    let mockTx: any;

    beforeEach(() => {
      mockTx = {
        user: {
          findUnique: vi.fn(),
        },
        auditNote: {
          create: vi.fn(),
        },
        auditImage: {
          findMany: vi.fn().mockResolvedValue([]),
        },
      };
    });

    it("creates a note when audit is completed without user note", async () => {
      mockTx.user.findUnique.mockResolvedValue({
        id: "user-1",
        firstName: "John",
        lastName: "Doe",
      });

      await createAuditCompletedNote({
        auditSessionId: "audit-1",
        userId: "user-1",
        expectedCount: 50,
        foundCount: 45,
        missingCount: 5,
        unexpectedCount: 3,
        tx: mockTx,
      });

      expect(mockTx.user.findUnique).toHaveBeenCalledWith({
        where: { id: "user-1" },
        select: {
          id: true,
          firstName: true,
          lastName: true,
        },
      });

      expect(mockTx.auditNote.create).toHaveBeenCalledWith({
        data: {
          auditSessionId: "audit-1",
          userId: "user-1",
          type: "COMMENT",
          content: expect.stringContaining("Audit completed"),
        },
      });
    });

    it("includes stats in note content", async () => {
      mockTx.user.findUnique.mockResolvedValue({
        id: "user-2",
        firstName: "Jane",
        lastName: "Smith",
      });

      await createAuditCompletedNote({
        auditSessionId: "audit-2",
        userId: "user-2",
        expectedCount: 100,
        foundCount: 90,
        missingCount: 10,
        unexpectedCount: 5,
        tx: mockTx,
      });

      const createCall = mockTx.auditNote.create.mock.calls[0][0];
      expect(createCall.data.content).toContain(
        "Found **90/100** expected assets"
      );
      expect(createCall.data.content).toContain("**90%**");
      expect(createCall.data.content).toContain("**10** missing");
      expect(createCall.data.content).toContain("**5** unexpected");
    });

    it("includes user's completion note when provided", async () => {
      mockTx.user.findUnique.mockResolvedValue({
        id: "user-3",
        firstName: "Bob",
        lastName: "Wilson",
      });

      await createAuditCompletedNote({
        auditSessionId: "audit-3",
        userId: "user-3",
        expectedCount: 50,
        foundCount: 48,
        missingCount: 2,
        unexpectedCount: 1,
        completionNote:
          "All critical assets accounted for. Minor items missing.",
        tx: mockTx,
      });

      const createCall = mockTx.auditNote.create.mock.calls[0][0];
      expect(createCall.data.content).toContain("**Completion note:**");
      expect(createCall.data.content).toContain(
        "All critical assets accounted for. Minor items missing."
      );
    });

    it("handles completion note with markdown formatting", async () => {
      mockTx.user.findUnique.mockResolvedValue({
        id: "user-4",
        firstName: "Alice",
        lastName: "Johnson",
      });

      const markdownNote = `## Summary\n\n- Found most items\n- **2 laptops** still missing\n- Need to check storage room`;

      await createAuditCompletedNote({
        auditSessionId: "audit-4",
        userId: "user-4",
        expectedCount: 25,
        foundCount: 23,
        missingCount: 2,
        unexpectedCount: 0,
        completionNote: markdownNote,
        tx: mockTx,
      });

      const createCall = mockTx.auditNote.create.mock.calls[0][0];
      // Check that the note is formatted as a blockquote
      expect(createCall.data.content).toContain("**Completion note:**");
      expect(createCall.data.content).toContain("> ## Summary");
      expect(createCall.data.content).toContain("> - Found most items");
      expect(createCall.data.content).toContain(
        "> - **2 laptops** still missing"
      );
    });

    it("calculates correct percentage", async () => {
      mockTx.user.findUnique.mockResolvedValue({
        id: "user-5",
        firstName: "Carol",
        lastName: "Davis",
      });

      await createAuditCompletedNote({
        auditSessionId: "audit-5",
        userId: "user-5",
        expectedCount: 30,
        foundCount: 27,
        missingCount: 3,
        unexpectedCount: 2,
        tx: mockTx,
      });

      const createCall = mockTx.auditNote.create.mock.calls[0][0];
      expect(createCall.data.content).toContain("**90%**"); // 27/30 = 90%
    });

    it("handles zero expected count without division error", async () => {
      mockTx.user.findUnique.mockResolvedValue({
        id: "user-6",
        firstName: "Dave",
        lastName: "Brown",
      });

      await createAuditCompletedNote({
        auditSessionId: "audit-6",
        userId: "user-6",
        expectedCount: 0,
        foundCount: 0,
        missingCount: 0,
        unexpectedCount: 5,
        tx: mockTx,
      });

      const createCall = mockTx.auditNote.create.mock.calls[0][0];
      expect(createCall.data.content).toContain("**0%**");
      expect(createCall.data.content).toContain(
        "Found **0/0** expected assets"
      );
    });

    it("does not include completion note section when note is empty string", async () => {
      mockTx.user.findUnique.mockResolvedValue({
        id: "user-7",
        firstName: "Eve",
        lastName: "Martinez",
      });

      await createAuditCompletedNote({
        auditSessionId: "audit-7",
        userId: "user-7",
        expectedCount: 10,
        foundCount: 10,
        missingCount: 0,
        unexpectedCount: 0,
        completionNote: "",
        tx: mockTx,
      });

      const createCall = mockTx.auditNote.create.mock.calls[0][0];
      expect(createCall.data.content).not.toContain("**Completion note:**");
    });

    it("does not include completion note section when note is whitespace", async () => {
      mockTx.user.findUnique.mockResolvedValue({
        id: "user-8",
        firstName: "Frank",
        lastName: "Garcia",
      });

      await createAuditCompletedNote({
        auditSessionId: "audit-8",
        userId: "user-8",
        expectedCount: 15,
        foundCount: 14,
        missingCount: 1,
        unexpectedCount: 1,
        completionNote: "   \n  ",
        tx: mockTx,
      });

      const createCall = mockTx.auditNote.create.mock.calls[0][0];
      expect(createCall.data.content).not.toContain("**Completion note:**");
    });

    it("skips note creation when user not found", async () => {
      mockTx.user.findUnique.mockResolvedValue(null);

      await createAuditCompletedNote({
        auditSessionId: "audit-9",
        userId: "nonexistent-user",
        expectedCount: 20,
        foundCount: 18,
        missingCount: 2,
        unexpectedCount: 0,
        tx: mockTx,
      });

      expect(mockTx.user.findUnique).toHaveBeenCalled();
      expect(mockTx.auditNote.create).not.toHaveBeenCalled();
    });

    it("includes audit_images tag when images exist", async () => {
      mockTx.user.findUnique.mockResolvedValue({
        id: "user-10",
        firstName: "Grace",
        lastName: "Wilson",
      });

      // Mock auditImage.findMany to return 3 images
      mockTx.auditImage.findMany.mockResolvedValue([
        { id: "img-1" },
        { id: "img-2" },
        { id: "img-3" },
      ]);

      await createAuditCompletedNote({
        auditSessionId: "audit-10",
        userId: "user-10",
        expectedCount: 50,
        foundCount: 48,
        missingCount: 2,
        unexpectedCount: 0,
        tx: mockTx,
      });

      expect(mockTx.auditImage.findMany).toHaveBeenCalledWith({
        where: {
          auditSessionId: "audit-10",
          auditAssetId: null,
        },
        select: { id: true },
        orderBy: { createdAt: "asc" },
      });

      const createCall = mockTx.auditNote.create.mock.calls[0][0];
      expect(createCall.data.content).toContain(
        '{% audit_images count=3 ids="img-1,img-2,img-3" /%}'
      );
    });

    it("does not include audit_images tag when no images exist", async () => {
      mockTx.user.findUnique.mockResolvedValue({
        id: "user-11",
        firstName: "Henry",
        lastName: "Taylor",
      });

      // Mock auditImage.findMany to return empty array
      mockTx.auditImage.findMany.mockResolvedValue([]);

      await createAuditCompletedNote({
        auditSessionId: "audit-11",
        userId: "user-11",
        expectedCount: 30,
        foundCount: 30,
        missingCount: 0,
        unexpectedCount: 0,
        tx: mockTx,
      });

      const createCall = mockTx.auditNote.create.mock.calls[0][0];
      expect(createCall.data.content).not.toContain("audit_images");
    });

    it("correctly formats image IDs in audit_images tag", async () => {
      mockTx.user.findUnique.mockResolvedValue({
        id: "user-12",
        firstName: "Isabel",
        lastName: "Anderson",
      });

      // Mock with 5 images (max limit)
      mockTx.auditImage.findMany.mockResolvedValue([
        { id: "abc-123" },
        { id: "def-456" },
        { id: "ghi-789" },
        { id: "jkl-012" },
        { id: "mno-345" },
      ]);

      await createAuditCompletedNote({
        auditSessionId: "audit-12",
        userId: "user-12",
        expectedCount: 100,
        foundCount: 95,
        missingCount: 5,
        unexpectedCount: 3,
        tx: mockTx,
      });

      const createCall = mockTx.auditNote.create.mock.calls[0][0];
      expect(createCall.data.content).toContain(
        '{% audit_images count=5 ids="abc-123,def-456,ghi-789,jkl-012,mno-345" /%}'
      );
    });
  });

  describe("createAuditAssetImagesAddedNote", () => {
    let mockTx: any;

    beforeEach(() => {
      mockTx = {
        user: {
          findUnique: vi.fn(),
        },
        auditAsset: {
          findUnique: vi.fn(),
        },
        auditNote: {
          create: vi.fn(),
        },
      };
    });

    it("creates a note with single image", async () => {
      mockTx.user.findUnique.mockResolvedValue({
        id: "user-1",
        firstName: "John",
        lastName: "Doe",
      });

      mockTx.auditAsset.findUnique.mockResolvedValue({
        id: "audit-asset-1",
        asset: {
          id: "asset-1",
          title: "Camera Equipment",
        },
      });

      await createAuditAssetImagesAddedNote({
        auditSessionId: "audit-1",
        auditAssetId: "audit-asset-1",
        userId: "user-1",
        imageIds: ["img-1"],
        tx: mockTx,
      });

      expect(mockTx.user.findUnique).toHaveBeenCalledWith({
        where: { id: "user-1" },
        select: {
          id: true,
          firstName: true,
          lastName: true,
        },
      });

      expect(mockTx.auditAsset.findUnique).toHaveBeenCalledWith({
        where: { id: "audit-asset-1" },
        include: {
          asset: {
            select: { id: true, title: true },
          },
        },
      });

      expect(mockTx.auditNote.create).toHaveBeenCalledWith({
        data: {
          auditSessionId: "audit-1",
          auditAssetId: "audit-asset-1",
          userId: "user-1",
          type: "UPDATE",
          content: expect.any(String),
        },
      });

      const createCall = mockTx.auditNote.create.mock.calls[0][0];
      expect(createCall.data.content).toContain(
        '{% audit_images count=1 ids="img-1" /%}'
      );
      expect(createCall.data.content).toContain('text="Camera Equipment"');
    });

    it("creates a note with multiple images", async () => {
      mockTx.user.findUnique.mockResolvedValue({
        id: "user-2",
        firstName: "Jane",
        lastName: "Smith",
      });

      mockTx.auditAsset.findUnique.mockResolvedValue({
        id: "audit-asset-2",
        asset: {
          id: "asset-2",
          title: "Laptop",
        },
      });

      await createAuditAssetImagesAddedNote({
        auditSessionId: "audit-2",
        auditAssetId: "audit-asset-2",
        userId: "user-2",
        imageIds: ["img-1", "img-2", "img-3"],
        tx: mockTx,
      });

      expect(mockTx.auditNote.create).toHaveBeenCalledWith({
        data: {
          auditSessionId: "audit-2",
          auditAssetId: "audit-asset-2",
          userId: "user-2",
          type: "UPDATE",
          content: expect.any(String),
        },
      });

      const createCall = mockTx.auditNote.create.mock.calls[0][0];
      expect(createCall.data.content).toContain(
        '{% audit_images count=3 ids="img-1,img-2,img-3" /%}'
      );
      expect(createCall.data.content).toContain('text="Laptop"');
    });

    it("includes asset link in note content", async () => {
      mockTx.user.findUnique.mockResolvedValue({
        id: "user-3",
        firstName: "Alice",
        lastName: "Johnson",
      });

      mockTx.auditAsset.findUnique.mockResolvedValue({
        id: "audit-asset-3",
        asset: {
          id: "asset-3",
          title: "Server Rack",
        },
      });

      await createAuditAssetImagesAddedNote({
        auditSessionId: "audit-3",
        auditAssetId: "audit-asset-3",
        userId: "user-3",
        imageIds: ["img-1", "img-2"],
        tx: mockTx,
      });

      const createCall = mockTx.auditNote.create.mock.calls[0][0];
      expect(createCall.data.content).toContain('to="/assets/asset-3"');
      expect(createCall.data.content).toContain('text="Server Rack"');
    });

    it("skips note creation when user not found", async () => {
      mockTx.user.findUnique.mockResolvedValue(null);
      mockTx.auditAsset.findUnique.mockResolvedValue({
        id: "audit-asset-4",
        asset: { id: "asset-4", title: "Test Asset" },
      });

      await createAuditAssetImagesAddedNote({
        auditSessionId: "audit-4",
        auditAssetId: "audit-asset-4",
        userId: "nonexistent-user",
        imageIds: ["img-1"],
        tx: mockTx,
      });

      expect(mockTx.auditNote.create).not.toHaveBeenCalled();
    });

    it("skips note creation when asset not found", async () => {
      mockTx.user.findUnique.mockResolvedValue({
        id: "user-5",
        firstName: "Bob",
        lastName: "Williams",
      });
      mockTx.auditAsset.findUnique.mockResolvedValue(null);

      await createAuditAssetImagesAddedNote({
        auditSessionId: "audit-5",
        auditAssetId: "nonexistent-asset",
        userId: "user-5",
        imageIds: ["img-1"],
        tx: mockTx,
      });

      expect(mockTx.auditNote.create).not.toHaveBeenCalled();
    });
  });

  describe("createAssetsAddedToAuditNote", () => {
    let mockTx: any;

    beforeEach(() => {
      mockTx = {
        user: {
          findUnique: vi.fn(),
        },
        asset: {
          findMany: vi.fn(),
        },
        auditNote: {
          create: vi.fn(),
        },
      };
    });

    it("creates a note for single asset added", async () => {
      mockTx.user.findUnique.mockResolvedValue({
        id: "user-1",
        firstName: "John",
        lastName: "Doe",
      });
      mockTx.asset.findMany.mockResolvedValue([
        { id: "asset-1", title: "Camera A" },
      ]);

      await createAssetsAddedToAuditNote({
        auditSessionId: "audit-1",
        userId: "user-1",
        addedAssetIds: ["asset-1"],
        skippedCount: 0,
        tx: mockTx,
      });

      expect(mockTx.asset.findMany).toHaveBeenCalledWith({
        where: { id: { in: ["asset-1"] } },
        select: { id: true, title: true },
        orderBy: { title: "asc" },
      });

      expect(mockTx.auditNote.create).toHaveBeenCalledWith({
        data: {
          auditSessionId: "audit-1",
          userId: "user-1",
          type: "UPDATE",
          content: expect.stringContaining("added"),
        },
      });
    });

    it("creates a note for multiple assets added", async () => {
      mockTx.user.findUnique.mockResolvedValue({
        id: "user-2",
        firstName: "Jane",
        lastName: "Smith",
      });
      mockTx.asset.findMany.mockResolvedValue([
        { id: "asset-1", title: "Camera A" },
        { id: "asset-2", title: "Camera B" },
        { id: "asset-3", title: "Laptop C" },
      ]);

      await createAssetsAddedToAuditNote({
        auditSessionId: "audit-2",
        userId: "user-2",
        addedAssetIds: ["asset-1", "asset-2", "asset-3"],
        skippedCount: 0,
        tx: mockTx,
      });

      expect(mockTx.auditNote.create).toHaveBeenCalledWith({
        data: {
          auditSessionId: "audit-2",
          userId: "user-2",
          type: "UPDATE",
          content: expect.stringContaining("added"),
        },
      });
    });

    it("includes skipped count when assets were skipped", async () => {
      mockTx.user.findUnique.mockResolvedValue({
        id: "user-3",
        firstName: "Bob",
        lastName: "Wilson",
      });
      mockTx.asset.findMany.mockResolvedValue([
        { id: "asset-1", title: "Camera A" },
        { id: "asset-2", title: "Camera B" },
      ]);

      await createAssetsAddedToAuditNote({
        auditSessionId: "audit-3",
        userId: "user-3",
        addedAssetIds: ["asset-1", "asset-2"],
        skippedCount: 3,
        tx: mockTx,
      });

      const createCall = mockTx.auditNote.create.mock.calls[0][0];
      expect(createCall.data.content).toContain("3");
      expect(createCall.data.content).toContain("skipped");
    });

    it("includes user link in note content", async () => {
      mockTx.user.findUnique.mockResolvedValue({
        id: "user-4",
        firstName: "Alice",
        lastName: "Johnson",
      });
      mockTx.asset.findMany.mockResolvedValue([
        { id: "asset-1", title: "Monitor" },
      ]);

      await createAssetsAddedToAuditNote({
        auditSessionId: "audit-4",
        userId: "user-4",
        addedAssetIds: ["asset-1"],
        skippedCount: 0,
        tx: mockTx,
      });

      const createCall = mockTx.auditNote.create.mock.calls[0][0];
      expect(createCall.data.content).toContain(
        '{% link to="/settings/team/users/user-4"'
      );
      expect(createCall.data.content).toContain('text="Alice Johnson"');
    });

    it("fetches assets sorted by title", async () => {
      mockTx.user.findUnique.mockResolvedValue({
        id: "user-5",
        firstName: "Carol",
        lastName: "Davis",
      });
      mockTx.asset.findMany.mockResolvedValue([
        { id: "asset-3", title: "A-Camera" },
        { id: "asset-1", title: "B-Laptop" },
        { id: "asset-2", title: "C-Monitor" },
      ]);

      await createAssetsAddedToAuditNote({
        auditSessionId: "audit-5",
        userId: "user-5",
        addedAssetIds: ["asset-1", "asset-2", "asset-3"],
        skippedCount: 0,
        tx: mockTx,
      });

      expect(mockTx.asset.findMany).toHaveBeenCalledWith({
        where: { id: { in: ["asset-1", "asset-2", "asset-3"] } },
        select: { id: true, title: true },
        orderBy: { title: "asc" },
      });
    });

    it("skips note creation when user not found", async () => {
      mockTx.user.findUnique.mockResolvedValue(null);
      mockTx.asset.findMany.mockResolvedValue([
        { id: "asset-1", title: "Camera" },
      ]);

      await createAssetsAddedToAuditNote({
        auditSessionId: "audit-6",
        userId: "nonexistent-user",
        addedAssetIds: ["asset-1"],
        skippedCount: 0,
        tx: mockTx,
      });

      expect(mockTx.auditNote.create).not.toHaveBeenCalled();
    });

    it("skips note creation when no assets found", async () => {
      mockTx.user.findUnique.mockResolvedValue({
        id: "user-7",
        firstName: "Dave",
        lastName: "Brown",
      });
      mockTx.asset.findMany.mockResolvedValue([]);

      await createAssetsAddedToAuditNote({
        auditSessionId: "audit-7",
        userId: "user-7",
        addedAssetIds: ["nonexistent-asset"],
        skippedCount: 0,
        tx: mockTx,
      });

      expect(mockTx.auditNote.create).not.toHaveBeenCalled();
    });
  });

  describe("createAssetRemovedFromAuditNote", () => {
    let mockTx: any;

    beforeEach(() => {
      mockTx = {
        user: {
          findUnique: vi.fn(),
        },
        asset: {
          findUnique: vi.fn(),
        },
        auditNote: {
          create: vi.fn(),
        },
      };
    });

    it("creates a note when asset is removed", async () => {
      mockTx.user.findUnique.mockResolvedValue({
        id: "user-1",
        firstName: "John",
        lastName: "Doe",
      });
      mockTx.asset.findUnique.mockResolvedValue({
        id: "asset-1",
        title: "Camera A",
      });

      await createAssetRemovedFromAuditNote({
        auditSessionId: "audit-1",
        assetId: "asset-1",
        userId: "user-1",
        tx: mockTx,
      });

      expect(mockTx.asset.findUnique).toHaveBeenCalledWith({
        where: { id: "asset-1" },
        select: { id: true, title: true },
      });

      expect(mockTx.auditNote.create).toHaveBeenCalledWith({
        data: {
          auditSessionId: "audit-1",
          userId: "user-1",
          type: "UPDATE",
          content: expect.stringContaining("removed"),
        },
      });
    });

    it("includes user link in note content", async () => {
      mockTx.user.findUnique.mockResolvedValue({
        id: "user-2",
        firstName: "Jane",
        lastName: "Smith",
      });
      mockTx.asset.findUnique.mockResolvedValue({
        id: "asset-2",
        title: "Laptop B",
      });

      await createAssetRemovedFromAuditNote({
        auditSessionId: "audit-2",
        assetId: "asset-2",
        userId: "user-2",
        tx: mockTx,
      });

      const createCall = mockTx.auditNote.create.mock.calls[0][0];
      expect(createCall.data.content).toContain(
        '{% link to="/settings/team/users/user-2"'
      );
      expect(createCall.data.content).toContain('text="Jane Smith"');
    });

    it("includes asset link in note content", async () => {
      mockTx.user.findUnique.mockResolvedValue({
        id: "user-3",
        firstName: "Bob",
        lastName: "Wilson",
      });
      mockTx.asset.findUnique.mockResolvedValue({
        id: "asset-3",
        title: "Monitor C",
      });

      await createAssetRemovedFromAuditNote({
        auditSessionId: "audit-3",
        assetId: "asset-3",
        userId: "user-3",
        tx: mockTx,
      });

      const createCall = mockTx.auditNote.create.mock.calls[0][0];
      expect(createCall.data.content).toContain('{% link to="/assets/asset-3"');
      expect(createCall.data.content).toContain('text="Monitor C"');
    });

    it("skips note creation when user not found", async () => {
      mockTx.user.findUnique.mockResolvedValue(null);
      mockTx.asset.findUnique.mockResolvedValue({
        id: "asset-4",
        title: "Keyboard D",
      });

      await createAssetRemovedFromAuditNote({
        auditSessionId: "audit-4",
        assetId: "asset-4",
        userId: "nonexistent-user",
        tx: mockTx,
      });

      expect(mockTx.auditNote.create).not.toHaveBeenCalled();
    });

    it("skips note creation when asset not found", async () => {
      mockTx.user.findUnique.mockResolvedValue({
        id: "user-5",
        firstName: "Alice",
        lastName: "Johnson",
      });
      mockTx.asset.findUnique.mockResolvedValue(null);

      await createAssetRemovedFromAuditNote({
        auditSessionId: "audit-5",
        assetId: "nonexistent-asset",
        userId: "user-5",
        tx: mockTx,
      });

      expect(mockTx.auditNote.create).not.toHaveBeenCalled();
    });
  });

  describe("createAssetsRemovedFromAuditNote", () => {
    let mockTx: any;

    beforeEach(() => {
      mockTx = {
        user: {
          findUnique: vi.fn(),
        },
        asset: {
          findMany: vi.fn(),
        },
        auditNote: {
          create: vi.fn(),
        },
      };
    });

    it("creates a note for single asset removed", async () => {
      mockTx.user.findUnique.mockResolvedValue({
        id: "user-1",
        firstName: "John",
        lastName: "Doe",
      });
      mockTx.asset.findMany.mockResolvedValue([
        { id: "asset-1", title: "Camera A" },
      ]);

      await createAssetsRemovedFromAuditNote({
        auditSessionId: "audit-1",
        assetIds: ["asset-1"],
        userId: "user-1",
        tx: mockTx,
      });

      expect(mockTx.asset.findMany).toHaveBeenCalledWith({
        where: { id: { in: ["asset-1"] } },
        select: { id: true, title: true },
        orderBy: { title: "asc" },
      });

      expect(mockTx.auditNote.create).toHaveBeenCalledWith({
        data: {
          auditSessionId: "audit-1",
          userId: "user-1",
          type: "UPDATE",
          content: expect.stringContaining("removed"),
        },
      });
    });

    it("creates a note for multiple assets removed", async () => {
      mockTx.user.findUnique.mockResolvedValue({
        id: "user-2",
        firstName: "Jane",
        lastName: "Smith",
      });
      mockTx.asset.findMany.mockResolvedValue([
        { id: "asset-1", title: "Camera A" },
        { id: "asset-2", title: "Camera B" },
        { id: "asset-3", title: "Laptop C" },
      ]);

      await createAssetsRemovedFromAuditNote({
        auditSessionId: "audit-2",
        assetIds: ["asset-1", "asset-2", "asset-3"],
        userId: "user-2",
        tx: mockTx,
      });

      expect(mockTx.auditNote.create).toHaveBeenCalledWith({
        data: {
          auditSessionId: "audit-2",
          userId: "user-2",
          type: "UPDATE",
          content: expect.stringContaining("removed"),
        },
      });
    });

    it("includes user link in note content", async () => {
      mockTx.user.findUnique.mockResolvedValue({
        id: "user-3",
        firstName: "Bob",
        lastName: "Wilson",
      });
      mockTx.asset.findMany.mockResolvedValue([
        { id: "asset-1", title: "Monitor" },
      ]);

      await createAssetsRemovedFromAuditNote({
        auditSessionId: "audit-3",
        assetIds: ["asset-1"],
        userId: "user-3",
        tx: mockTx,
      });

      const createCall = mockTx.auditNote.create.mock.calls[0][0];
      expect(createCall.data.content).toContain(
        '{% link to="/settings/team/users/user-3"'
      );
      expect(createCall.data.content).toContain('text="Bob Wilson"');
    });

    it("fetches assets sorted by title", async () => {
      mockTx.user.findUnique.mockResolvedValue({
        id: "user-4",
        firstName: "Alice",
        lastName: "Johnson",
      });
      mockTx.asset.findMany.mockResolvedValue([
        { id: "asset-3", title: "A-Camera" },
        { id: "asset-1", title: "B-Laptop" },
        { id: "asset-2", title: "C-Monitor" },
      ]);

      await createAssetsRemovedFromAuditNote({
        auditSessionId: "audit-4",
        assetIds: ["asset-1", "asset-2", "asset-3"],
        userId: "user-4",
        tx: mockTx,
      });

      expect(mockTx.asset.findMany).toHaveBeenCalledWith({
        where: { id: { in: ["asset-1", "asset-2", "asset-3"] } },
        select: { id: true, title: true },
        orderBy: { title: "asc" },
      });
    });

    it("skips note creation when user not found", async () => {
      mockTx.user.findUnique.mockResolvedValue(null);
      mockTx.asset.findMany.mockResolvedValue([
        { id: "asset-1", title: "Camera" },
      ]);

      await createAssetsRemovedFromAuditNote({
        auditSessionId: "audit-5",
        assetIds: ["asset-1"],
        userId: "nonexistent-user",
        tx: mockTx,
      });

      expect(mockTx.auditNote.create).not.toHaveBeenCalled();
    });

    it("skips note creation when no assets found", async () => {
      mockTx.user.findUnique.mockResolvedValue({
        id: "user-6",
        firstName: "Carol",
        lastName: "Davis",
      });
      mockTx.asset.findMany.mockResolvedValue([]);

      await createAssetsRemovedFromAuditNote({
        auditSessionId: "audit-6",
        assetIds: ["nonexistent-asset"],
        userId: "user-6",
        tx: mockTx,
      });

      expect(mockTx.auditNote.create).not.toHaveBeenCalled();
    });
  });
});
