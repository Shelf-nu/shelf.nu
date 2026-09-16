import { beforeEach, describe, expect, it, vi } from "vitest";
import { ShelfError } from "~/utils/error";
import { MAX_SAVED_REPORTS } from "./constants";
import {
  createSavedReport,
  deleteSavedReport,
  listSavedReports,
  renameSavedReport,
} from "./service.server";

// @vitest-environment node

const record = {
  id: "rep-1",
  name: "Laptops by campus",
  query: "dataset=assets&groupBy=location",
  createdAt: new Date("2026-09-16T10:00:00Z"),
  updatedAt: new Date("2026-09-16T10:00:00Z"),
  createdById: "user-1",
  createdBy: { firstName: "Ada", lastName: "Lovelace", displayName: null },
};

type MockDb = {
  $transaction: ReturnType<typeof vi.fn>;
  savedReport: {
    findMany: ReturnType<typeof vi.fn>;
    count: ReturnType<typeof vi.fn>;
    findFirst: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    deleteMany: ReturnType<typeof vi.fn>;
  };
};

const dbMock = vi.hoisted<MockDb>(() => ({
  $transaction: vi.fn(),
  savedReport: {
    findMany: vi.fn(),
    count: vi.fn(),
    findFirst: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    deleteMany: vi.fn(),
  },
}));

// why: the service is pure orchestration over Prisma; the database is the
// only external dependency and these tests pin the calls it makes.
vi.mock("~/database/db.server", () => ({ db: dbMock }));

async function expectShelfError(promise: Promise<unknown>, status: number) {
  const err = await promise.catch((e: unknown) => e);
  expect(err).toBeInstanceOf(ShelfError);
  expect((err as ShelfError).status).toBe(status);
  return err as ShelfError;
}

describe("saved reports service", () => {
  beforeEach(() => {
    Object.values(dbMock.savedReport).forEach((m) => m.mockReset());
    dbMock.$transaction.mockReset();
    dbMock.$transaction.mockImplementation((cb: (tx: MockDb) => unknown) =>
      cb(dbMock)
    );
  });

  describe("listSavedReports", () => {
    it("lists the workspace's reports by name", async () => {
      dbMock.savedReport.findMany.mockResolvedValue([record]);

      const result = await listSavedReports({ organizationId: "org-1" });

      expect(result).toEqual([record]);
      expect(dbMock.savedReport.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { organizationId: "org-1" },
          orderBy: { name: "asc" },
        })
      );
    });
  });

  describe("createSavedReport", () => {
    it("stores the trimmed name and the sanitised query", async () => {
      dbMock.savedReport.count.mockResolvedValue(0);
      dbMock.savedReport.findFirst.mockResolvedValue(null);
      dbMock.savedReport.create.mockResolvedValue(record);

      const result = await createSavedReport({
        organizationId: "org-1",
        createdById: "user-1",
        name: "  Laptops by campus  ",
        query: "?dataset=assets&groupBy=location&page=4",
      });

      expect(result).toEqual(record);
      expect(dbMock.savedReport.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: {
            organizationId: "org-1",
            createdById: "user-1",
            name: "Laptops by campus",
            query: "dataset=assets&groupBy=location",
          },
        })
      );
    });

    it("refuses an empty name before touching the database", async () => {
      await expectShelfError(
        createSavedReport({
          organizationId: "org-1",
          createdById: "user-1",
          name: "   ",
          query: "dataset=assets",
        }),
        400
      );
      expect(dbMock.$transaction).not.toHaveBeenCalled();
    });

    it("refuses a duplicate name within the workspace with 409, ignoring case", async () => {
      dbMock.savedReport.count.mockResolvedValue(1);
      dbMock.savedReport.findFirst.mockResolvedValue({ id: "other" });

      const err = await expectShelfError(
        createSavedReport({
          organizationId: "org-1",
          createdById: "user-1",
          name: "laptops BY campus",
          query: "dataset=assets",
        }),
        409
      );
      expect(err.message).toContain("laptops BY campus");
      expect(dbMock.savedReport.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            organizationId: "org-1",
            name: { equals: "laptops BY campus", mode: "insensitive" },
          },
        })
      );
      expect(dbMock.savedReport.create).not.toHaveBeenCalled();
    });

    it("refuses to exceed the per-workspace cap", async () => {
      dbMock.savedReport.count.mockResolvedValue(MAX_SAVED_REPORTS);

      await expectShelfError(
        createSavedReport({
          organizationId: "org-1",
          createdById: "user-1",
          name: "One more",
          query: "dataset=assets",
        }),
        400
      );
      expect(dbMock.savedReport.findFirst).not.toHaveBeenCalled();
      expect(dbMock.savedReport.create).not.toHaveBeenCalled();
    });
  });

  describe("renameSavedReport", () => {
    it("renames a report of the workspace", async () => {
      dbMock.savedReport.findFirst
        .mockResolvedValueOnce(record)
        .mockResolvedValueOnce(null);
      dbMock.savedReport.update.mockResolvedValue({
        ...record,
        name: "Laptops per campus",
      });

      const result = await renameSavedReport({
        id: "rep-1",
        organizationId: "org-1",
        name: "Laptops per campus",
      });

      expect(result.name).toBe("Laptops per campus");
      expect(dbMock.savedReport.findFirst).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          where: { id: "rep-1", organizationId: "org-1" },
        })
      );
      expect(dbMock.savedReport.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "rep-1" },
          data: { name: "Laptops per campus" },
        })
      );
    });

    it("is a no-op when the name is unchanged", async () => {
      dbMock.savedReport.findFirst.mockResolvedValueOnce(record);

      const result = await renameSavedReport({
        id: "rep-1",
        organizationId: "org-1",
        name: " Laptops by campus ",
      });

      expect(result).toEqual(record);
      expect(dbMock.savedReport.update).not.toHaveBeenCalled();
    });

    it("returns 404 for an id outside the workspace", async () => {
      dbMock.savedReport.findFirst.mockResolvedValueOnce(null);

      await expectShelfError(
        renameSavedReport({
          id: "foreign",
          organizationId: "org-1",
          name: "Anything",
        }),
        404
      );
      expect(dbMock.savedReport.update).not.toHaveBeenCalled();
    });

    it("refuses a name another report already uses, ignoring case", async () => {
      dbMock.savedReport.findFirst
        .mockResolvedValueOnce(record)
        .mockResolvedValueOnce({ id: "rep-2" });

      await expectShelfError(
        renameSavedReport({
          id: "rep-1",
          organizationId: "org-1",
          name: "Taken",
        }),
        409
      );
      expect(dbMock.savedReport.findFirst).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          where: {
            organizationId: "org-1",
            name: { equals: "Taken", mode: "insensitive" },
            NOT: { id: "rep-1" },
          },
        })
      );
      expect(dbMock.savedReport.update).not.toHaveBeenCalled();
    });
  });

  describe("deleteSavedReport", () => {
    it("deletes with the workspace in the predicate", async () => {
      dbMock.savedReport.deleteMany.mockResolvedValue({ count: 1 });

      await deleteSavedReport({ id: "rep-1", organizationId: "org-1" });

      expect(dbMock.savedReport.deleteMany).toHaveBeenCalledWith({
        where: { id: "rep-1", organizationId: "org-1" },
      });
    });

    it("returns 404 when nothing matched", async () => {
      dbMock.savedReport.deleteMany.mockResolvedValue({ count: 0 });

      await expectShelfError(
        deleteSavedReport({ id: "foreign", organizationId: "org-1" }),
        404
      );
    });
  });
});
