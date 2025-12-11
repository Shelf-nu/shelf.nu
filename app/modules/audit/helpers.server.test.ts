import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  createAssetScanNote,
  createAuditCreationNote,
} from "./helpers.server";

// Mock the markdoc wrappers
vi.mock("~/utils/markdoc-wrappers", () => ({
  // why: We need to mock the markdoc wrapper functions to avoid complex template rendering in tests
  wrapUserLinkForNote: vi.fn(
    (user: { id: string; firstName?: string | null; lastName?: string | null }) =>
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
          content: expect.stringContaining("created this audit with **1** expected asset."),
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
          content: expect.stringContaining("created this audit with **5** expected assets."),
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
      expect(createCall.data.content).toContain('{% link to="/settings/team/users/user-3"');
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
});
