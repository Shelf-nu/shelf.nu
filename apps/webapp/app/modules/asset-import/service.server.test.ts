// @vitest-environment node
/**
 * Tests for `confirmAssetImport`: the guards before an import is queued and
 * what happens when the queue refuses the first step.
 *
 * @see {@link file://./service.server.ts}
 */
import { PrismaClientKnownRequestError } from "@prisma/client/runtime/library";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { db } from "~/database/db.server";
import { ShelfError } from "~/utils/error";
import { confirmAssetImport } from "./service.server";
import { validateContentImportFile } from "./validate.server";
import { enqueueAssetImportStep } from "./worker.server";

// why: the import row lives in the database.
vi.mock("~/database/db.server", () => ({
  db: { assetImport: { findFirst: vi.fn(), updateMany: vi.fn() } },
}));

// why: the queue has its own tests; here only the step sent matters.
vi.mock("./worker.server", () => ({ enqueueAssetImportStep: vi.fn() }));

// why: validation has its own tests; here only whether it passes matters.
vi.mock("./validate.server", () => ({ validateContentImportFile: vi.fn() }));

const hoursAgo = (hours: number) => new Date(Date.now() - hours * 3600 * 1000);

function draft(overrides: Record<string, unknown> = {}) {
  return {
    id: "imp",
    status: "DRAFT",
    rows: [{ key: "k", title: "Drill", assetId: "a1", rowNumber: 2 }],
    canUseBarcodes: false,
    createdAt: new Date(),
    ...overrides,
  };
}

const args = { importId: "imp", organizationId: "org", userId: "u" };

describe("confirmAssetImport", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(validateContentImportFile).mockResolvedValue(undefined);
    vi.mocked(enqueueAssetImportStep).mockResolvedValue(undefined);
    vi.mocked(db.assetImport.updateMany).mockResolvedValue({ count: 1 });
  });

  it("re-validates the stored rows, queues the import and sends the PREPARE step", async () => {
    vi.mocked(db.assetImport.findFirst)
      .mockResolvedValueOnce(draft() as never)
      .mockResolvedValueOnce(null);

    await confirmAssetImport(args);

    expect(validateContentImportFile).toHaveBeenCalledWith(
      expect.objectContaining({ data: draft().rows })
    );
    expect(db.assetImport.updateMany).toHaveBeenCalledWith({
      where: { id: "imp", organizationId: "org", status: "DRAFT" },
      data: {
        status: "QUEUED",
        phase: "PREPARE",
        confirmedAt: expect.any(Date),
      },
    });
    expect(enqueueAssetImportStep).toHaveBeenCalledWith({
      importId: "imp",
      step: "PREPARE",
    });
  });

  it("refuses a file whose stored rows no longer validate", async () => {
    vi.mocked(db.assetImport.findFirst)
      .mockResolvedValueOnce(draft() as never)
      .mockResolvedValueOnce(null);
    vi.mocked(validateContentImportFile).mockRejectedValueOnce(
      new ShelfError({
        cause: null,
        message: "Row 2 is invalid",
        label: "Assets",
        status: 400,
      })
    );

    await expect(confirmAssetImport(args)).rejects.toMatchObject({
      status: 400,
    });
    expect(enqueueAssetImportStep).not.toHaveBeenCalled();
  });

  it("404s for a draft in another workspace", async () => {
    vi.mocked(db.assetImport.findFirst).mockResolvedValueOnce(null);

    await expect(confirmAssetImport(args)).rejects.toMatchObject({
      status: 404,
    });
  });

  it("409s while the workspace has an import queued or running", async () => {
    vi.mocked(db.assetImport.findFirst)
      .mockResolvedValueOnce(draft() as never)
      .mockResolvedValueOnce({ id: "other" } as never);

    await expect(confirmAssetImport(args)).rejects.toMatchObject({
      status: 409,
    });
    expect(enqueueAssetImportStep).not.toHaveBeenCalled();
  });

  it("refuses a draft older than 24 hours", async () => {
    vi.mocked(db.assetImport.findFirst)
      .mockResolvedValueOnce(draft({ createdAt: hoursAgo(25) }) as never)
      .mockResolvedValueOnce(null);

    await expect(confirmAssetImport(args)).rejects.toMatchObject({
      status: 400,
    });
    expect(enqueueAssetImportStep).not.toHaveBeenCalled();
  });

  it("puts the draft back and rethrows when the PREPARE step cannot be sent", async () => {
    vi.mocked(db.assetImport.findFirst)
      .mockResolvedValueOnce(draft() as never)
      .mockResolvedValueOnce(null);
    vi.mocked(enqueueAssetImportStep).mockRejectedValueOnce(
      new Error("queue down")
    );

    await expect(confirmAssetImport(args)).rejects.toThrow("queue down");
    expect(db.assetImport.updateMany).toHaveBeenLastCalledWith({
      where: { id: "imp", organizationId: "org", status: "QUEUED" },
      data: { status: "DRAFT" },
    });
  });

  it("409s without queuing or rolling back when the draft was already confirmed", async () => {
    vi.mocked(db.assetImport.findFirst)
      .mockResolvedValueOnce(draft() as never)
      .mockResolvedValueOnce(null);
    vi.mocked(db.assetImport.updateMany).mockResolvedValueOnce({ count: 0 });

    await expect(confirmAssetImport(args)).rejects.toMatchObject({
      status: 409,
    });
    expect(enqueueAssetImportStep).not.toHaveBeenCalled();
    expect(db.assetImport.updateMany).toHaveBeenCalledTimes(1);
  });

  it("409s when the database refuses a second active import in the workspace", async () => {
    vi.mocked(db.assetImport.findFirst)
      .mockResolvedValueOnce(draft() as never)
      .mockResolvedValueOnce(null);
    vi.mocked(db.assetImport.updateMany).mockRejectedValueOnce(
      new PrismaClientKnownRequestError("unique", {
        code: "P2002",
        clientVersion: "test",
      })
    );

    await expect(confirmAssetImport(args)).rejects.toMatchObject({
      status: 409,
    });
    expect(enqueueAssetImportStep).not.toHaveBeenCalled();
  });
});
