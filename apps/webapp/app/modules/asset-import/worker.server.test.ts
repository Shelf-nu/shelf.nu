// @vitest-environment node
/**
 * Tests for the asset import job runner: the queue producer (queue name,
 * payload, options and singleton key per step), and how each job runs its
 * step, holds the lease, chains the next step and fails the import.
 *
 * @see {@link file://./worker.server.ts}
 */
import type { AssetImport } from "@prisma/client";
import type PgBoss from "pg-boss";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { db } from "~/database/db.server";
import { sendAssetImportFinishedEmail } from "~/emails/asset-import-finished";
import { ShelfError } from "~/utils/error";
import { scheduler } from "~/utils/scheduler.server";
import { createSignedUrl, uploadImageFromUrl } from "~/utils/storage.server";
import { writeImportChunk } from "./chunk-writer.server";
import {
  ASSET_IMPORT_IMAGE_BUDGET_MS,
  ASSET_IMPORT_JOB_OPTIONS,
} from "./constants";
import { runFinalizeStep } from "./finalize.server";
import { claimImportLease, releaseImportLease } from "./lease.server";
import { runPrepareStep, userCanStillImport } from "./prepare.server";
import type {
  AssetImportJobData,
  ResolvedImportEntities,
  StoredImportRow,
} from "./types";
import {
  enqueueAssetImportStep,
  handleAssetImportJob,
  registerAssetImportWorkers,
} from "./worker.server";

// why: no pg-boss instance exists in unit tests.
vi.mock("~/utils/scheduler.server", () => ({
  QueueNames: { assetImportQueue: "asset-import-queue" },
  scheduler: { send: vi.fn(), work: vi.fn() },
}));

// why: the import row lives in the database.
vi.mock("~/database/db.server", () => ({
  db: { assetImport: { findFirst: vi.fn(), updateMany: vi.fn() } },
}));

// why: the chunk writer runs one database transaction and has its own tests.
vi.mock("./chunk-writer.server", () => ({ writeImportChunk: vi.fn() }));

// why: PREPARE writes to the database and has its own tests.
vi.mock("./prepare.server", () => ({
  runPrepareStep: vi.fn(),
  userCanStillImport: vi.fn(),
}));

// why: FINALIZE writes to the database and has its own tests.
vi.mock("./finalize.server", () => ({ runFinalizeStep: vi.fn() }));

// why: the lease is a database update; here only who holds it matters.
vi.mock("./lease.server", () => ({
  claimImportLease: vi.fn(),
  renewImportLease: vi.fn(),
  releaseImportLease: vi.fn(),
}));

// why: image download and storage go over the network.
vi.mock("~/utils/storage.server", () => ({
  uploadImageFromUrl: vi.fn(),
  createSignedUrl: vi.fn(),
}));

// why: the email is sent over the network; here only whether it is sent.
vi.mock("~/emails/asset-import-finished", () => ({
  sendAssetImportFinishedEmail: vi.fn(),
}));

// why: the logger writes to the console and Sentry.
vi.mock("~/utils/logger", () => ({
  Logger: { info: vi.fn(), error: vi.fn() },
}));

/**
 * Makes the runner load this import.
 *
 * @param row - The import, or null for a missing one
 */
function loads(row: AssetImport | null) {
  vi.mocked(db.assetImport.findFirst).mockResolvedValue(row as never);
}

const resolved: ResolvedImportEntities = {
  kits: {},
  categories: {},
  locations: {},
  teamMembers: {},
  tags: {},
  customFields: {},
  assetModels: {},
  qrIdsByRowKey: {},
};

/**
 * A stored row with a title and the given cells.
 *
 * @param cells - Cells to set, `assetId` included
 */
function storedRow(cells: Partial<StoredImportRow> = {}): StoredImportRow {
  const assetId = cells.assetId ?? "a";
  return {
    key: `key-${assetId}`,
    title: `Asset ${assetId}`,
    rowNumber: 2,
    assetId,
    ...cells,
  };
}

/**
 * An import row. Without `rows`, holds `totalRows` plain rows.
 *
 * @param overrides - Fields to set
 */
function imp(overrides: Partial<AssetImport> = {}): AssetImport {
  const totalRows = overrides.totalRows ?? 1;
  return {
    id: "imp",
    status: "RUNNING",
    phase: "ROWS",
    fileName: "assets.csv",
    totalRows,
    processedRows: 0,
    rows: Array.from({ length: totalRows }, (_, i) =>
      storedRow({ assetId: `a${i}`, rowNumber: i + 2 })
    ),
    resolved,
    canUseBarcodes: false,
    errorMessage: null,
    warnings: null,
    warningCount: 0,
    lockedUntil: null,
    confirmedAt: new Date(),
    startedAt: new Date(),
    completedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    createdById: "u",
    organizationId: "org",
    ...overrides,
  } as AssetImport;
}

/**
 * A pg-boss job on its first attempt unless `meta` says otherwise.
 *
 * @param data - The step payload
 * @param meta - Retry metadata overrides
 */
function job(
  data: AssetImportJobData,
  meta: { retrycount?: number; retrylimit?: number } = {}
): PgBoss.JobWithMetadata<AssetImportJobData> {
  return {
    id: "job",
    name: "asset-import-queue",
    data,
    retrycount: 0,
    retrylimit: 3,
    ...meta,
  } as PgBoss.JobWithMetadata<AssetImportJobData>;
}

describe("enqueueAssetImportStep", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(scheduler.send).mockResolvedValue("job-1");
  });

  it.each([
    [{ importId: "imp", step: "PREPARE" as const }, "imp:PREPARE"],
    [{ importId: "imp", step: "ROWS" as const, chunkIndex: 3 }, "imp:ROWS:3"],
    [{ importId: "imp", step: "FINALIZE" as const }, "imp:FINALIZE"],
  ])("sends %j with singleton key %s", async (data, singletonKey) => {
    await enqueueAssetImportStep(data);

    expect(scheduler.send).toHaveBeenCalledWith("asset-import-queue", data, {
      ...ASSET_IMPORT_JOB_OPTIONS,
      singletonKey,
    });
  });

  it("treats a step that is already queued as success", async () => {
    vi.mocked(scheduler.send).mockResolvedValue(null);

    await expect(
      enqueueAssetImportStep({ importId: "imp", step: "PREPARE" })
    ).resolves.toBeUndefined();
  });

  it("wraps a queue failure in a ShelfError", async () => {
    vi.mocked(scheduler.send).mockRejectedValue(new Error("connection lost"));

    const error = await enqueueAssetImportStep({
      importId: "imp",
      step: "FINALIZE",
    }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ShelfError);
    expect(error).toMatchObject({ label: "Asset Import" });
  });
});

describe("registerAssetImportWorkers", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("polls the import queue with retry metadata", async () => {
    await registerAssetImportWorkers();

    expect(scheduler.work).toHaveBeenCalledWith(
      "asset-import-queue",
      expect.objectContaining({ includeMetadata: true, teamSize: 2 }),
      handleAssetImportJob
    );
  });
});

describe("handleAssetImportJob", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(scheduler.send).mockResolvedValue("job-1");
    vi.mocked(claimImportLease).mockResolvedValue(true);
    vi.mocked(userCanStillImport).mockResolvedValue(true);
    vi.mocked(createSignedUrl).mockResolvedValue("https://signed.test/a");
    vi.mocked(db.assetImport.updateMany).mockResolvedValue({ count: 0 });
  });

  it("ROWS: writes the chunk and enqueues the next one", async () => {
    loads(imp({ status: "RUNNING", totalRows: 250, processedRows: 100 }));
    vi.mocked(writeImportChunk).mockResolvedValue({
      applied: true,
      nextProcessedRows: 200,
      warnings: [],
    });

    await handleAssetImportJob(
      job({ importId: "imp", step: "ROWS", chunkIndex: 1 })
    );

    expect(writeImportChunk).toHaveBeenCalledWith(
      expect.objectContaining({
        chunkStart: 100,
        rows: expect.any(Array),
        organizationId: "org",
        userId: "u",
      })
    );
    expect(vi.mocked(writeImportChunk).mock.calls[0][0].rows).toHaveLength(100);
    expect(scheduler.send).toHaveBeenCalledWith(
      "asset-import-queue",
      { importId: "imp", step: "ROWS", chunkIndex: 2 },
      expect.objectContaining({ singletonKey: "imp:ROWS:2", retryLimit: 3 })
    );
  });

  it("ROWS: the last chunk enqueues FINALIZE", async () => {
    loads(imp({ status: "RUNNING", totalRows: 250, processedRows: 200 }));
    vi.mocked(writeImportChunk).mockResolvedValue({
      applied: true,
      nextProcessedRows: 250,
      warnings: [],
    });

    await handleAssetImportJob(
      job({ importId: "imp", step: "ROWS", chunkIndex: 2 })
    );

    expect(vi.mocked(writeImportChunk).mock.calls[0][0].rows).toHaveLength(50);
    expect(scheduler.send).toHaveBeenCalledWith(
      "asset-import-queue",
      { importId: "imp", step: "FINALIZE" },
      expect.anything()
    );
  });

  it("re-enqueues the next step when the chunk was already applied", async () => {
    loads(
      imp({
        status: "RUNNING",
        totalRows: 250,
        processedRows: 200,
        rows: Array.from({ length: 250 }, (_, i) =>
          storedRow({ assetId: `a${i}`, imageUrl: "https://x.test/a.jpg" })
        ),
      })
    );

    await handleAssetImportJob(
      job({ importId: "imp", step: "ROWS", chunkIndex: 1 })
    );

    expect(writeImportChunk).not.toHaveBeenCalled();
    expect(uploadImageFromUrl).not.toHaveBeenCalled();
    expect(scheduler.send).toHaveBeenCalledWith(
      "asset-import-queue",
      { importId: "imp", step: "ROWS", chunkIndex: 2 },
      expect.anything()
    );
  });

  it("exits quietly when another run holds the lease", async () => {
    loads(imp({ status: "RUNNING", totalRows: 250 }));
    vi.mocked(claimImportLease).mockResolvedValueOnce(false);

    await expect(
      handleAssetImportJob(
        job(
          { importId: "imp", step: "ROWS", chunkIndex: 0 },
          { retrycount: 3, retrylimit: 3 }
        )
      )
    ).resolves.toBeUndefined();

    expect(writeImportChunk).not.toHaveBeenCalled();
    expect(scheduler.send).not.toHaveBeenCalled();
    expect(releaseImportLease).not.toHaveBeenCalled();
    expect(vi.mocked(db.assetImport.updateMany)).not.toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "FAILED" }),
      })
    );
  });

  it("releases the lease before enqueuing the next step", async () => {
    loads(imp({ status: "RUNNING", totalRows: 250, processedRows: 0 }));
    vi.mocked(writeImportChunk).mockResolvedValue({
      applied: true,
      nextProcessedRows: 100,
      warnings: [],
    });

    await handleAssetImportJob(
      job({ importId: "imp", step: "ROWS", chunkIndex: 0 })
    );

    const releaseOrder =
      vi.mocked(releaseImportLease).mock.invocationCallOrder[0];
    const sendOrder = vi.mocked(scheduler.send).mock.invocationCallOrder[0];
    expect(releaseOrder).toBeLessThan(sendOrder);
    // Released once: `finally` does not release a lease already handed off.
    expect(releaseImportLease).toHaveBeenCalledTimes(1);
  });

  it("PREPARE runs the step and enqueues what it returns", async () => {
    const queued = imp({ status: "QUEUED", phase: "PREPARE" });
    loads(queued);
    vi.mocked(runPrepareStep).mockResolvedValue({
      importId: "imp",
      step: "ROWS",
      chunkIndex: 0,
    });

    await handleAssetImportJob(job({ importId: "imp", step: "PREPARE" }));

    expect(runPrepareStep).toHaveBeenCalledWith(queued);
    expect(scheduler.send).toHaveBeenCalledWith(
      "asset-import-queue",
      { importId: "imp", step: "ROWS", chunkIndex: 0 },
      expect.objectContaining({ singletonKey: "imp:ROWS:0" })
    );
  });

  it("PREPARE fails the import when the user lost import permission", async () => {
    loads(imp({ status: "QUEUED" }));
    vi.mocked(db.assetImport.updateMany).mockResolvedValue({ count: 1 });
    vi.mocked(userCanStillImport).mockResolvedValueOnce(false);

    await handleAssetImportJob(job({ importId: "imp", step: "PREPARE" }));

    expect(runPrepareStep).not.toHaveBeenCalled();
    expect(vi.mocked(db.assetImport.updateMany)).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "FAILED",
          errorMessage: expect.stringContaining("permission"),
        }),
      })
    );
    expect(scheduler.send).not.toHaveBeenCalled();
    expect(releaseImportLease).toHaveBeenCalled();
  });

  it("FINALIZE runs the step and queues nothing after it", async () => {
    loads(imp({ status: "RUNNING", processedRows: 1 }));

    await handleAssetImportJob(job({ importId: "imp", step: "FINALIZE" }));

    expect(runFinalizeStep).toHaveBeenCalled();
    expect(scheduler.send).not.toHaveBeenCalled();
    expect(releaseImportLease).toHaveBeenCalled();
  });

  it("FINALIZE with rows still missing continues from the real progress", async () => {
    loads(imp({ status: "RUNNING", totalRows: 250, processedRows: 100 }));

    await handleAssetImportJob(job({ importId: "imp", step: "FINALIZE" }));

    expect(runFinalizeStep).not.toHaveBeenCalled();
    expect(scheduler.send).toHaveBeenCalledWith(
      "asset-import-queue",
      { importId: "imp", step: "ROWS", chunkIndex: 1 },
      expect.anything()
    );
  });

  it.each(["COMPLETED", "FAILED", "DRAFT"] as const)(
    "ignores a job for a %s import",
    async (status) => {
      loads(imp({ status }));

      await handleAssetImportJob(
        job({ importId: "imp", step: "ROWS", chunkIndex: 0 })
      );

      expect(claimImportLease).not.toHaveBeenCalled();
      expect(writeImportChunk).not.toHaveBeenCalled();
    }
  );

  it("ignores a ROWS job for an import that has not run PREPARE", async () => {
    loads(imp({ status: "QUEUED" }));

    await handleAssetImportJob(
      job({ importId: "imp", step: "ROWS", chunkIndex: 0 })
    );

    expect(writeImportChunk).not.toHaveBeenCalled();
  });

  it("ignores a job for an import that no longer exists", async () => {
    loads(null);

    await expect(
      handleAssetImportJob(job({ importId: "imp", step: "FINALIZE" }))
    ).resolves.toBeUndefined();
    expect(runFinalizeStep).not.toHaveBeenCalled();
  });

  it("rethrows without failing the import while retries remain", async () => {
    loads(imp({ status: "RUNNING", totalRows: 10 }));
    vi.mocked(writeImportChunk).mockRejectedValue(new Error("P1001"));

    await expect(
      handleAssetImportJob(
        job(
          { importId: "imp", step: "ROWS", chunkIndex: 0 },
          { retrycount: 1, retrylimit: 3 }
        )
      )
    ).rejects.toThrow("P1001");

    expect(vi.mocked(db.assetImport.updateMany)).not.toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "FAILED" }),
      })
    );
    expect(releaseImportLease).toHaveBeenCalled();
  });

  it("retries a user error too while retries remain", async () => {
    loads(imp({ status: "RUNNING", totalRows: 10 }));
    vi.mocked(writeImportChunk).mockRejectedValue(
      new ShelfError({
        cause: null,
        message: "Bad number",
        label: "Asset Import",
        status: 400,
      })
    );

    await expect(
      handleAssetImportJob(
        job({ importId: "imp", step: "ROWS", chunkIndex: 0 })
      )
    ).rejects.toThrow("Bad number");
    expect(sendAssetImportFinishedEmail).not.toHaveBeenCalled();
  });

  it("marks the import failed and emails once on the last attempt", async () => {
    loads(imp({ status: "RUNNING", totalRows: 10 }));
    vi.mocked(db.assetImport.updateMany).mockResolvedValue({ count: 1 });
    vi.mocked(writeImportChunk).mockRejectedValue(new Error("boom"));

    await expect(
      handleAssetImportJob(
        job(
          { importId: "imp", step: "ROWS", chunkIndex: 0 },
          { retrycount: 3, retrylimit: 3 }
        )
      )
    ).rejects.toThrow("boom");

    expect(vi.mocked(db.assetImport.updateMany)).toHaveBeenCalledWith({
      where: {
        id: "imp",
        organizationId: "org",
        status: { in: ["QUEUED", "RUNNING"] },
      },
      data: {
        status: "FAILED",
        errorMessage: expect.stringContaining("Resume"),
      },
    });
    expect(sendAssetImportFinishedEmail).toHaveBeenCalledOnce();
    expect(sendAssetImportFinishedEmail).toHaveBeenCalledWith({
      importId: "imp",
      organizationId: "org",
      outcome: "failed",
    });
  });

  it("stores a user error's own message on the last attempt", async () => {
    loads(imp({ status: "RUNNING", totalRows: 10 }));
    vi.mocked(db.assetImport.updateMany).mockResolvedValue({ count: 1 });
    vi.mocked(writeImportChunk).mockRejectedValue(
      new ShelfError({
        cause: null,
        message: "Use plain numbers for AMOUNT fields.",
        label: "Asset Import",
        status: 400,
      })
    );

    await expect(
      handleAssetImportJob(
        job(
          { importId: "imp", step: "ROWS", chunkIndex: 0 },
          { retrycount: 3, retrylimit: 3 }
        )
      )
    ).rejects.toThrow();

    expect(vi.mocked(db.assetImport.updateMany)).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          status: "FAILED",
          errorMessage: "Use plain numbers for AMOUNT fields.",
        },
      })
    );
  });

  it("uploads images outside the transaction with a path derived from the asset id", async () => {
    loads(
      imp({
        status: "RUNNING",
        totalRows: 1,
        rows: [storedRow({ assetId: "a1", imageUrl: "https://x.test/a.jpg" })],
      })
    );
    vi.mocked(uploadImageFromUrl).mockResolvedValue("u/a1/main-image-import");
    vi.mocked(writeImportChunk).mockResolvedValue({
      applied: true,
      nextProcessedRows: 1,
      warnings: [],
    });

    await handleAssetImportJob(
      job({ importId: "imp", step: "ROWS", chunkIndex: 0 })
    );

    expect(uploadImageFromUrl).toHaveBeenCalledWith(
      "https://x.test/a.jpg",
      expect.objectContaining({ filename: "u/a1/main-image-import" }),
      expect.anything()
    );
    expect(writeImportChunk).toHaveBeenCalledWith(
      expect.objectContaining({
        imagePaths: {
          a1: {
            mainImage: "https://signed.test/a",
            mainImageExpiration: expect.any(Date),
          },
        },
      })
    );
    // The upload finished before the chunk's transaction started.
    expect(
      vi.mocked(uploadImageFromUrl).mock.invocationCallOrder[0]
    ).toBeLessThan(vi.mocked(writeImportChunk).mock.invocationCallOrder[0]);
  });

  it("imports the asset without its image when the upload fails", async () => {
    loads(
      imp({
        status: "RUNNING",
        totalRows: 1,
        rows: [storedRow({ assetId: "a1", imageUrl: "https://x.test/a.jpg" })],
      })
    );
    vi.mocked(uploadImageFromUrl).mockRejectedValue(new Error("not an image"));
    vi.mocked(writeImportChunk).mockResolvedValue({
      applied: true,
      nextProcessedRows: 1,
      warnings: [],
    });

    await handleAssetImportJob(
      job({ importId: "imp", step: "ROWS", chunkIndex: 0 })
    );

    expect(writeImportChunk).toHaveBeenCalledWith(
      expect.objectContaining({
        imagePaths: {},
        extraWarnings: [
          {
            row: 2,
            title: "Asset a1",
            message:
              'Image "https://x.test/a.jpg" could not be downloaded; the asset was imported without an image.',
          },
        ],
      })
    );
  });

  it("fetches a failing image URL once per chunk and warns for every row using it", async () => {
    loads(
      imp({
        status: "RUNNING",
        totalRows: 3,
        rows: [
          storedRow({
            assetId: "a1",
            rowNumber: 2,
            imageUrl: "https://dead.test/x.jpg",
          }),
          storedRow({
            assetId: "a2",
            rowNumber: 3,
            imageUrl: "https://dead.test/x.jpg",
          }),
          storedRow({
            assetId: "a3",
            rowNumber: 4,
            imageUrl: "https://dead.test/x.jpg",
          }),
        ],
      })
    );
    // A failed download comes back as null, not a throw.
    vi.mocked(uploadImageFromUrl).mockResolvedValue(null);
    vi.mocked(writeImportChunk).mockResolvedValue({
      applied: true,
      nextProcessedRows: 3,
      warnings: [],
    });

    await handleAssetImportJob(
      job({ importId: "imp", step: "ROWS", chunkIndex: 0 })
    );

    expect(uploadImageFromUrl).toHaveBeenCalledTimes(1);
    const { extraWarnings } = vi.mocked(writeImportChunk).mock.calls[0][0];
    expect(extraWarnings?.map((w) => w.row)).toEqual([2, 3, 4]);
    expect(extraWarnings?.[0].message).toContain("could not be downloaded");
  });

  it("warns for an invalid image URL without fetching it", async () => {
    loads(
      imp({
        status: "RUNNING",
        totalRows: 1,
        rows: [storedRow({ assetId: "a1", imageUrl: "ftp://x.test/a.jpg" })],
      })
    );
    vi.mocked(writeImportChunk).mockResolvedValue({
      applied: true,
      nextProcessedRows: 1,
      warnings: [],
    });

    await handleAssetImportJob(
      job({ importId: "imp", step: "ROWS", chunkIndex: 0 })
    );

    expect(uploadImageFromUrl).not.toHaveBeenCalled();
    expect(
      vi.mocked(writeImportChunk).mock.calls[0][0].extraWarnings
    ).toHaveLength(1);
  });

  describe("image time budget", () => {
    beforeEach(() => {
      // why: the budget is measured with Date.now(); only Date is faked so
      // promises and pg-boss mocks behave normally.
      vi.useFakeTimers({ toFake: ["Date"] });
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("skips the remaining images once the budget is spent and warns for each", async () => {
      loads(
        imp({
          status: "RUNNING",
          totalRows: 3,
          rows: [
            storedRow({
              assetId: "a1",
              rowNumber: 2,
              imageUrl: "https://x.test/1.jpg",
            }),
            storedRow({
              assetId: "a2",
              rowNumber: 3,
              imageUrl: "https://x.test/2.jpg",
            }),
            storedRow({
              assetId: "a3",
              rowNumber: 4,
              imageUrl: "https://x.test/3.jpg",
            }),
          ],
        })
      );
      // The first image takes longer than the whole budget.
      vi.mocked(uploadImageFromUrl).mockImplementation(() => {
        vi.setSystemTime(Date.now() + ASSET_IMPORT_IMAGE_BUDGET_MS + 1);
        return Promise.resolve("u/a1/main-image-import");
      });
      vi.mocked(writeImportChunk).mockResolvedValue({
        applied: true,
        nextProcessedRows: 3,
        warnings: [],
      });

      await handleAssetImportJob(
        job({ importId: "imp", step: "ROWS", chunkIndex: 0 })
      );

      expect(uploadImageFromUrl).toHaveBeenCalledTimes(1);
      const call = vi.mocked(writeImportChunk).mock.calls[0][0];
      expect(Object.keys(call.imagePaths)).toEqual(["a1"]);
      expect(call.extraWarnings).toEqual([
        expect.objectContaining({
          row: 3,
          message: expect.stringContaining("ran out of time for images"),
        }),
        expect.objectContaining({
          row: 4,
          message: expect.stringContaining("ran out of time for images"),
        }),
      ]);
    });
  });
});
