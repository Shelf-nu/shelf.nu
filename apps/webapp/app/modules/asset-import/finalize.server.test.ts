// @vitest-environment node
/**
 * Tests for the FINALIZE step: which kits get custody, how a failing kit
 * becomes a warning instead of failing the import, the completion update and
 * when the completion email goes out.
 *
 * @see {@link file://./finalize.server.ts}
 */
import { Prisma } from "@prisma/client";
import type { AssetImport } from "@prisma/client";
import { PrismaClientKnownRequestError } from "@prisma/client/runtime/library";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { db } from "~/database/db.server";
import { sendAssetImportFinishedEmail } from "~/emails/asset-import-finished";
import { bulkAssignKitCustody } from "~/modules/kit/service.server";
import { ShelfError } from "~/utils/error";
import { appendImportWarnings } from "./chunk-writer.server";
import { runFinalizeStep } from "./finalize.server";
import type { ResolvedImportEntities, StoredImportRow } from "./types";

// why: the import, kit custody and team members live in the database. The
// completion runs in a transaction whose callback gets the same fake client.
vi.mock("~/database/db.server", () => {
  const db = {
    assetImport: { updateMany: vi.fn() },
    kitCustody: { findMany: vi.fn() },
    teamMember: { findMany: vi.fn() },
    $transaction: vi.fn(),
  };
  return { db };
});

// why: kit custody assignment is a large database flow with its own tests.
vi.mock("~/modules/kit/service.server", () => ({
  bulkAssignKitCustody: vi.fn(),
}));

// why: storing warnings is a raw SQL update, tested with the chunk writer.
vi.mock("./chunk-writer.server", () => ({ appendImportWarnings: vi.fn() }));

// why: the email is sent over the network; here only whether it is sent.
vi.mock("~/emails/asset-import-finished", () => ({
  sendAssetImportFinishedEmail: vi.fn(),
}));

const resolved: ResolvedImportEntities = {
  kits: { "Kit A": "kit-a", "Kit B": "kit-b", "Kit C": "kit-c" },
  categories: {},
  locations: {},
  teamMembers: { Sam: "tm-sam", Ann: "tm-ann" },
  tags: {},
  customFields: {},
  assetModels: {},
  qrIdsByRowKey: {},
};

/**
 * A stored row.
 *
 * @param rowNumber - Spreadsheet line
 * @param cells - Kit and custodian cells
 */
function row(
  rowNumber: number,
  cells: Partial<StoredImportRow> = {}
): StoredImportRow {
  return {
    key: `k${rowNumber}`,
    title: `Asset ${rowNumber}`,
    assetId: `a${rowNumber}`,
    rowNumber,
    ...cells,
  };
}

/**
 * A RUNNING import holding the given rows.
 *
 * @param rows - Stored rows
 */
function imp(rows: StoredImportRow[]): AssetImport {
  return {
    id: "imp",
    status: "RUNNING",
    phase: "ROWS",
    totalRows: rows.length,
    processedRows: rows.length,
    rows,
    resolved,
    createdById: "u",
    organizationId: "org",
  } as unknown as AssetImport;
}

describe("runFinalizeStep", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(db.assetImport.updateMany).mockResolvedValue({ count: 1 });
    vi.mocked(db.kitCustody.findMany).mockResolvedValue([] as never);
    vi.mocked(db.teamMember.findMany).mockResolvedValue([
      { id: "tm-sam", name: "Sam" },
      { id: "tm-ann", name: "Ann" },
    ] as never);
    vi.mocked(db.$transaction).mockImplementation(((
      callback: (tx: typeof db) => unknown
    ) => callback(db)) as never);
    vi.mocked(bulkAssignKitCustody).mockResolvedValue(undefined as never);
  });

  it("assigns custody once per custodian, only for kits without custody", async () => {
    vi.mocked(db.kitCustody.findMany).mockResolvedValue([
      { kitId: "kit-b" },
    ] as never);

    await runFinalizeStep(
      imp([
        row(2, { kit: "Kit A", custodian: "Sam" }),
        row(3, { kit: " Kit A ", custodian: "Sam" }),
        row(4, { kit: "Kit B", custodian: "Sam" }),
        row(5, { kit: "Kit C", custodian: "Ann" }),
        row(6, { kit: "Kit A" }),
        row(7, { custodian: "Sam" }),
      ])
    );

    expect(bulkAssignKitCustody).toHaveBeenCalledTimes(2);
    expect(bulkAssignKitCustody).toHaveBeenCalledWith(
      expect.objectContaining({
        kitIds: ["kit-a"],
        custodianId: "tm-sam",
        custodianName: "Sam",
        organizationId: "org",
        userId: "u",
      })
    );
    expect(bulkAssignKitCustody).toHaveBeenCalledWith(
      expect.objectContaining({ kitIds: ["kit-c"], custodianId: "tm-ann" })
    );
  });

  it("retries a failing group kit by kit and turns each kit that still fails into one warning", async () => {
    vi.mocked(bulkAssignKitCustody).mockImplementation((({
      kitIds,
    }: {
      kitIds: string[];
    }) =>
      kitIds.includes("kit-b")
        ? Promise.reject(
            new ShelfError({
              cause: null,
              message: "Kit B has checked out assets.",
              label: "Kit",
              status: 400,
            })
          )
        : Promise.resolve(undefined)) as never);

    await runFinalizeStep(
      imp([
        row(2, { kit: "Kit A", custodian: "Sam" }),
        row(3, { kit: "Kit B", custodian: "Sam" }),
        row(4, { kit: "Kit B", custodian: "Sam" }),
      ])
    );

    expect(bulkAssignKitCustody).toHaveBeenCalledWith(
      expect.objectContaining({ kitIds: ["kit-a", "kit-b"] })
    );
    expect(bulkAssignKitCustody).toHaveBeenCalledWith(
      expect.objectContaining({ kitIds: ["kit-a"] })
    );
    expect(appendImportWarnings).toHaveBeenCalledWith(db, "imp", [
      {
        row: 3,
        title: "Asset 3",
        message:
          'Custody for kit "Kit B" was not assigned: Kit B has checked out assets.',
      },
    ]);
    // The import still completes.
    expect(db.assetImport.updateMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "COMPLETED" }),
      })
    );
  });

  it("rethrows a transient database error instead of storing a warning", async () => {
    vi.mocked(bulkAssignKitCustody).mockRejectedValue(
      new ShelfError({
        cause: new PrismaClientKnownRequestError("pool timeout", {
          code: "P2024",
          clientVersion: "test",
        }),
        message: "Something went wrong while assigning custody",
        label: "Kit",
      })
    );

    await expect(
      runFinalizeStep(imp([row(2, { kit: "Kit A", custodian: "Sam" })]))
    ).rejects.toThrow("Something went wrong while assigning custody");

    expect(appendImportWarnings).not.toHaveBeenCalled();
    expect(db.assetImport.updateMany).not.toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "COMPLETED" }),
      })
    );
    expect(sendAssetImportFinishedEmail).not.toHaveBeenCalled();
  });

  it("completes the import, clears its rows and emails the creator", async () => {
    await runFinalizeStep(imp([row(2)]));

    expect(bulkAssignKitCustody).not.toHaveBeenCalled();
    expect(db.assetImport.updateMany).toHaveBeenLastCalledWith({
      where: { id: "imp", organizationId: "org", status: "RUNNING" },
      data: {
        status: "COMPLETED",
        completedAt: expect.any(Date),
        rows: Prisma.DbNull,
      },
    });
    expect(sendAssetImportFinishedEmail).toHaveBeenCalledWith({
      importId: "imp",
      organizationId: "org",
      outcome: "completed",
    });
  });

  it("sends no email when the import was no longer RUNNING", async () => {
    vi.mocked(db.assetImport.updateMany)
      .mockResolvedValueOnce({ count: 0 })
      .mockResolvedValueOnce({ count: 0 });

    await runFinalizeStep(imp([row(2)]));

    expect(sendAssetImportFinishedEmail).not.toHaveBeenCalled();
  });
});
