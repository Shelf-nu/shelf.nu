import { vi } from "vitest";
import { db } from "~/database/db.server";
import {
  createAuditSession,
  updateAuditSession,
  completeAuditSession,
  getActiveAuditSession,
} from "./service.server";

// @vitest-environment node
// 👋 see https://vitest.dev/guide/environment.html#environments-for-specific-files

// Mock dependencies
vi.mock("~/database/db.server", () => ({
  db: {
    auditSession: {
      create: vi.fn().mockResolvedValue({
        id: "test-audit-id",
        type: "LOCATION",
        targetId: "test-location-id",
        status: "ACTIVE",
        expectedAssetCount: 5,
        foundAssetCount: 0,
        missingAssetCount: 0,
        unexpectedAssetCount: 0,
        createdById: "test-user-id",
        organizationId: "test-org-id",
        createdAt: new Date(),
        completedAt: null,
      }),
      findFirst: vi.fn().mockResolvedValue(null),
      update: vi.fn().mockResolvedValue({
        id: "test-audit-id",
        status: "COMPLETED",
        completedAt: new Date(),
      }),
    },
  },
}));

describe("Audit Service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("createAuditSession", () => {
    it("should create a new audit session successfully", async () => {
      const payload = {
        type: "LOCATION" as const,
        targetId: "test-location-id",
        userId: "test-user-id",
        organizationId: "test-org-id",
        expectedAssetCount: 5,
      };

      const result = await createAuditSession(payload);

      expect(db.auditSession.create).toHaveBeenCalledWith({
        data: {
          type: "LOCATION",
          targetId: "test-location-id",
          expectedAssetCount: 5,
          createdById: "test-user-id",
          organizationId: "test-org-id",
        },
      });

      expect(result).toEqual(
        expect.objectContaining({
          id: "test-audit-id",
          type: "LOCATION",
          targetId: "test-location-id",
          status: "ACTIVE",
        })
      );
    });

    it("should prevent creating duplicate active audit sessions", async () => {
      // Mock existing active session
      (db.auditSession.findFirst as any).mockResolvedValueOnce({
        id: "existing-audit-id",
        status: "ACTIVE",
      });

      const payload = {
        type: "LOCATION" as const,
        targetId: "test-location-id",
        userId: "test-user-id",
        organizationId: "test-org-id",
        expectedAssetCount: 5,
      };

      await expect(createAuditSession(payload)).rejects.toThrow(
        "Failed to create audit session"
      );

      expect(db.auditSession.create).not.toHaveBeenCalled();
    });
  });

  describe("updateAuditSession", () => {
    it("should update audit session counts", async () => {
      const payload = {
        id: "test-audit-id",
        organizationId: "test-org-id",
        foundAssetCount: 3,
        missingAssetCount: 2,
        unexpectedAssetCount: 1,
      };

      await updateAuditSession(payload);

      expect(db.auditSession.update).toHaveBeenCalledWith({
        where: {
          id: "test-audit-id",
          organizationId: "test-org-id",
          status: "ACTIVE",
        },
        data: {
          foundAssetCount: 3,
          missingAssetCount: 2,
          unexpectedAssetCount: 1,
        },
      });
    });
  });

  describe("completeAuditSession", () => {
    it("should complete an audit session", async () => {
      const payload = {
        id: "test-audit-id",
        organizationId: "test-org-id",
      };

      await completeAuditSession(payload);

      expect(db.auditSession.update).toHaveBeenCalledWith({
        where: {
          id: "test-audit-id",
          organizationId: "test-org-id",
          status: "ACTIVE",
        },
        data: {
          status: "COMPLETED",
          completedAt: expect.any(Date),
        },
      });
    });
  });

  describe("getActiveAuditSession", () => {
    it("should retrieve active audit session", async () => {
      const mockSession = {
        id: "test-audit-id",
        type: "LOCATION",
        targetId: "test-location-id",
        status: "ACTIVE",
        createdBy: {
          id: "test-user-id",
          firstName: "Test",
          lastName: "User",
          email: "test@example.com",
        },
      };

      (db.auditSession.findFirst as any).mockResolvedValueOnce(mockSession);

      const result = await getActiveAuditSession({
        type: "LOCATION",
        targetId: "test-location-id",
        organizationId: "test-org-id",
      });

      expect(db.auditSession.findFirst).toHaveBeenCalledWith({
        where: {
          type: "LOCATION",
          targetId: "test-location-id",
          organizationId: "test-org-id",
          status: "ACTIVE",
        },
        include: {
          createdBy: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              email: true,
            },
          },
        },
      });

      expect(result).toEqual(mockSession);
    });
  });
});