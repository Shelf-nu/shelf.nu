// @vitest-environment node
/**
 * Tests for `confirmAssetImport` and `resumeAssetImport`: the guards before
 * an import is queued and what happens when the queue refuses the first step.
 * Also covers stall detection, which fails a QUEUED or RUNNING import that
 * stopped moving exactly once.
 *
 * @see {@link file://./service.server.ts}
 */
import type { AssetImport } from "@prisma/client";
import { PrismaClientKnownRequestError } from "@prisma/client/runtime/library";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { db } from "~/database/db.server";
import { sendAssetImportFinishedEmail } from "~/emails/asset-import-finished";
import { ShelfError } from "~/utils/error";
import { IMPORT_STALLED_MESSAGE } from "./failure.server";
import {
  confirmAssetImport,
  getActiveAssetImport,
  getAssetImportDetails,
  getAssetImportStatus,
  markStalledImportIfNeeded,
  resumeAssetImport,
} from "./service.server";
import { validateContentImportFile } from "./validate.server";
import { enqueueAssetImportStep } from "./worker.server";

// why: the import row lives in the database.
vi.mock("~/database/db.server", () => ({
  db: {
    assetImport: { findFirst: vi.fn(), updateMany: vi.fn() },
    $queryRaw: vi.fn(),
  },
}));

// why: the queue has its own tests; here only the step sent matters.
vi.mock("./worker.server", () => ({ enqueueAssetImportStep: vi.fn() }));

// why: validation has its own tests; here only whether it passes matters.
vi.mock("./validate.server", () => ({ validateContentImportFile: vi.fn() }));

// why: the email is sent over the network; here only whether it is sent.
vi.mock("~/emails/asset-import-finished", () => ({
  sendAssetImportFinishedEmail: vi.fn(),
}));

const hoursAgo = (hours: number) => new Date(Date.now() - hours * 3600 * 1000);
const minutesAgo = (minutes: number) =>
  new Date(Date.now() - minutes * 60 * 1000);

/**
 * An import row in the given state.
 *
 * @param overrides - Fields to set
 */
function imp(overrides: Partial<AssetImport> = {}): AssetImport {
  return {
    id: "imp",
    status: "RUNNING",
    organizationId: "org",
    createdById: "u",
    errorMessage: null,
    updatedAt: new Date(),
    ...overrides,
  } as AssetImport;
}

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

const args = {
  importId: "imp",
  organizationId: "org",
  userId: "u",
  canUseBarcodes: true,
};

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

    // The draft stored canUseBarcodes: false; the workspace's flag now wins
    // for both the re-validation and the job.
    expect(validateContentImportFile).toHaveBeenCalledWith(
      expect.objectContaining({ data: draft().rows, canUseBarcodes: true })
    );
    expect(db.assetImport.updateMany).toHaveBeenCalledWith({
      where: { id: "imp", organizationId: "org", status: "DRAFT" },
      data: {
        status: "QUEUED",
        phase: "PREPARE",
        confirmedAt: expect.any(Date),
        canUseBarcodes: true,
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

  it("409s for an import that has already left DRAFT", async () => {
    // A second press of Import finds the same row, now QUEUED.
    vi.mocked(db.assetImport.findFirst).mockResolvedValueOnce(
      draft({ status: "QUEUED" }) as never
    );

    await expect(confirmAssetImport(args)).rejects.toMatchObject({
      status: 409,
      message: "This import has already been confirmed.",
    });
    expect(db.assetImport.findFirst).toHaveBeenCalledWith({
      where: { id: "imp", organizationId: "org", createdById: "u" },
    });
    expect(validateContentImportFile).not.toHaveBeenCalled();
    expect(db.assetImport.updateMany).not.toHaveBeenCalled();
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

describe("markStalledImportIfNeeded", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("marks a stale RUNNING import as failed exactly once", async () => {
    vi.mocked(db.assetImport.updateMany)
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 });
    vi.mocked(db.assetImport.findFirst).mockResolvedValue(
      imp({ status: "FAILED" }) as never
    );
    const stale = imp({ status: "RUNNING", updatedAt: minutesAgo(61) });

    const first = await markStalledImportIfNeeded(stale);
    await markStalledImportIfNeeded(stale);

    expect(db.assetImport.updateMany).toHaveBeenCalledWith({
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
    expect(first.status).toBe("FAILED");
  });

  it("leaves a stale-looking import alone while its next job waits in the queue", async () => {
    vi.mocked(db.$queryRaw).mockResolvedValue([{ live: true }] as never);
    const waiting = imp({ status: "RUNNING", updatedAt: minutesAgo(61) });

    await expect(markStalledImportIfNeeded(waiting)).resolves.toBe(waiting);
    expect(db.assetImport.updateMany).not.toHaveBeenCalled();
    const sql = vi.mocked(db.$queryRaw).mock.calls[0][0] as unknown as {
      join: (separator: string) => string;
    };
    expect(sql.join("?")).toContain("pgboss.job");
    expect(vi.mocked(db.$queryRaw).mock.calls[0]).toContain("imp:%");
  });

  it("fails an import whose queued job has waited past the limit", async () => {
    vi.mocked(db.$queryRaw).mockResolvedValue([{ live: true }] as never);
    vi.mocked(db.assetImport.updateMany).mockResolvedValue({ count: 1 });
    vi.mocked(db.assetImport.findFirst).mockResolvedValue(
      imp({ status: "FAILED" }) as never
    );
    const lost = imp({ status: "QUEUED", updatedAt: minutesAgo(7 * 60) });

    const result = await markStalledImportIfNeeded(lost);

    expect(db.$queryRaw).not.toHaveBeenCalled();
    expect(result.status).toBe("FAILED");
  });

  it("falls back to the time rule when the queue lookup fails", async () => {
    vi.mocked(db.$queryRaw).mockRejectedValue(new Error("no pgboss schema"));
    vi.mocked(db.assetImport.updateMany).mockResolvedValue({ count: 1 });
    vi.mocked(db.assetImport.findFirst).mockResolvedValue(
      imp({ status: "FAILED" }) as never
    );
    const stale = imp({ status: "RUNNING", updatedAt: minutesAgo(61) });

    await expect(markStalledImportIfNeeded(stale)).resolves.toMatchObject({
      status: "FAILED",
    });
  });

  it("leaves a recently updated RUNNING import alone", async () => {
    const recent = imp({ status: "RUNNING", updatedAt: minutesAgo(5) });

    await expect(markStalledImportIfNeeded(recent)).resolves.toBe(recent);
    expect(db.assetImport.updateMany).not.toHaveBeenCalled();
  });

  it("marks a stale QUEUED import as failed once, freeing the workspace", async () => {
    vi.mocked(db.assetImport.updateMany)
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 });
    vi.mocked(db.assetImport.findFirst).mockResolvedValue(
      imp({ status: "FAILED" }) as never
    );
    // Its first job never ran, so nothing has touched it since confirm.
    const stuck = imp({ status: "QUEUED", updatedAt: minutesAgo(61) });

    const first = await markStalledImportIfNeeded(stuck);
    await markStalledImportIfNeeded(stuck);

    expect(db.assetImport.updateMany).toHaveBeenCalledWith({
      where: {
        id: "imp",
        organizationId: "org",
        status: { in: ["QUEUED", "RUNNING"] },
      },
      data: {
        status: "FAILED",
        errorMessage: IMPORT_STALLED_MESSAGE,
      },
    });
    expect(sendAssetImportFinishedEmail).toHaveBeenCalledOnce();
    expect(first.status).toBe("FAILED");
  });

  it("leaves a recently queued import alone", async () => {
    const recent = imp({ status: "QUEUED", updatedAt: minutesAgo(5) });

    await expect(markStalledImportIfNeeded(recent)).resolves.toBe(recent);
    expect(db.assetImport.updateMany).not.toHaveBeenCalled();
  });

  it("leaves an old import that is not QUEUED or RUNNING alone", async () => {
    await markStalledImportIfNeeded(
      imp({ status: "COMPLETED", updatedAt: minutesAgo(600) })
    );

    expect(db.assetImport.updateMany).not.toHaveBeenCalled();
  });
});

describe("resumeAssetImport", () => {
  const resumeArgs = {
    importId: "imp",
    organizationId: "org",
    canUseBarcodes: true,
  };

  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(enqueueAssetImportStep).mockResolvedValue(undefined);
    vi.mocked(db.assetImport.updateMany).mockResolvedValue({ count: 1 });
  });

  it("queues a FAILED import again from PREPARE", async () => {
    vi.mocked(db.assetImport.findFirst)
      .mockResolvedValueOnce({ id: "imp", errorMessage: "boom" } as never)
      .mockResolvedValueOnce(null);

    await expect(resumeAssetImport(resumeArgs)).resolves.toEqual({
      importId: "imp",
    });

    expect(db.assetImport.findFirst).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: { id: "imp", organizationId: "org", status: "FAILED" },
      })
    );
    expect(db.assetImport.updateMany).toHaveBeenCalledWith({
      where: { id: "imp", organizationId: "org", status: "FAILED" },
      data: {
        status: "QUEUED",
        phase: "PREPARE",
        lockedUntil: null,
        errorMessage: null,
        canUseBarcodes: true,
      },
    });
    expect(enqueueAssetImportStep).toHaveBeenCalledWith({
      importId: "imp",
      step: "PREPARE",
    });
  });

  it("404s for an import that is not FAILED", async () => {
    vi.mocked(db.assetImport.findFirst).mockResolvedValueOnce(null);

    await expect(resumeAssetImport(resumeArgs)).rejects.toMatchObject({
      status: 404,
    });
    expect(enqueueAssetImportStep).not.toHaveBeenCalled();
  });

  it("409s while another import is queued or running", async () => {
    vi.mocked(db.assetImport.findFirst)
      .mockResolvedValueOnce({ id: "imp", errorMessage: "boom" } as never)
      .mockResolvedValueOnce({ id: "other" } as never);

    await expect(resumeAssetImport(resumeArgs)).rejects.toMatchObject({
      status: 409,
    });
    expect(db.assetImport.updateMany).not.toHaveBeenCalled();
    expect(enqueueAssetImportStep).not.toHaveBeenCalled();
  });

  it("409s when the database refuses a second active import in the workspace", async () => {
    vi.mocked(db.assetImport.findFirst)
      .mockResolvedValueOnce({ id: "imp", errorMessage: "boom" } as never)
      .mockResolvedValueOnce(null);
    vi.mocked(db.assetImport.updateMany).mockRejectedValueOnce(
      new PrismaClientKnownRequestError("unique", {
        code: "P2002",
        clientVersion: "test",
      })
    );

    await expect(resumeAssetImport(resumeArgs)).rejects.toMatchObject({
      status: 409,
      message:
        "Another import is already running in this workspace. Wait for it to finish.",
    });
    expect(enqueueAssetImportStep).not.toHaveBeenCalled();
  });

  it("puts the import back to FAILED with its reason when PREPARE cannot be sent", async () => {
    vi.mocked(db.assetImport.findFirst)
      .mockResolvedValueOnce({ id: "imp", errorMessage: "boom" } as never)
      .mockResolvedValueOnce(null);
    vi.mocked(enqueueAssetImportStep).mockRejectedValueOnce(
      new Error("queue down")
    );

    await expect(resumeAssetImport(resumeArgs)).rejects.toThrow("queue down");
    expect(db.assetImport.updateMany).toHaveBeenLastCalledWith({
      where: { id: "imp", organizationId: "org", status: "QUEUED" },
      data: { status: "FAILED", errorMessage: "boom" },
    });
  });
});

describe("getAssetImportStatus and getAssetImportDetails", () => {
  const completedAt = new Date("2026-10-14T10:00:00.000Z");

  /** A loaded import row as the select returns it. */
  function row(overrides: Record<string, unknown> = {}) {
    return {
      id: "imp",
      organizationId: "org",
      createdById: "u",
      status: "COMPLETED",
      phase: "FINALIZE",
      fileName: "assets.csv",
      totalRows: 10,
      processedRows: 10,
      errorMessage: null,
      warningCount: 1,
      completedAt,
      updatedAt: new Date(),
      ...overrides,
    };
  }

  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("returns the status with ISO dates and isMine for the creator", async () => {
    vi.mocked(db.assetImport.findFirst).mockResolvedValueOnce(row() as never);

    const result = await getAssetImportStatus(args);

    expect(result).toEqual({
      id: "imp",
      status: "COMPLETED",
      phase: "FINALIZE",
      fileName: "assets.csv",
      totalRows: 10,
      processedRows: 10,
      errorMessage: null,
      warningCount: 1,
      completedAt: "2026-10-14T10:00:00.000Z",
      isMine: true,
    });
  });

  it("reports isMine false for another member of the workspace", async () => {
    vi.mocked(db.assetImport.findFirst).mockResolvedValueOnce(row() as never);

    const result = await getAssetImportStatus({ ...args, userId: "other" });

    expect(result.isMine).toBe(false);
  });

  it("scopes the lookup to the workspace, excludes drafts and never selects rows or warnings", async () => {
    vi.mocked(db.assetImport.findFirst).mockResolvedValueOnce(row() as never);

    await getAssetImportStatus(args);

    const query = vi.mocked(db.assetImport.findFirst).mock.calls[0][0];
    expect(query?.where).toEqual({
      id: "imp",
      organizationId: "org",
      status: { not: "DRAFT" },
    });
    expect(query?.select).not.toHaveProperty("rows");
    expect(query?.select).not.toHaveProperty("resolved");
    expect(query?.select).not.toHaveProperty("warnings");
  });

  it("404s when the import is not visible in the workspace", async () => {
    vi.mocked(db.assetImport.findFirst).mockResolvedValueOnce(null);

    await expect(getAssetImportStatus(args)).rejects.toMatchObject({
      status: 404,
    });
  });

  it("fails a stalled import and reports it as FAILED", async () => {
    vi.mocked(db.assetImport.findFirst)
      .mockResolvedValueOnce(
        row({
          status: "RUNNING",
          completedAt: null,
          updatedAt: minutesAgo(120),
        }) as never
      )
      .mockResolvedValueOnce(
        imp({
          status: "FAILED",
          phase: "ROWS",
          errorMessage: "stopped",
          completedAt: null,
          processedRows: 4,
          warningCount: 0,
        }) as never
      );
    vi.mocked(db.assetImport.updateMany).mockResolvedValue({ count: 1 });

    const result = await getAssetImportStatus(args);

    expect(result.status).toBe("FAILED");
    expect(result.errorMessage).toBe("stopped");
  });

  it("returns the stored warnings with the details", async () => {
    const warnings = [{ row: 2, title: "Drill", message: "QR code in use" }];
    vi.mocked(db.assetImport.findFirst).mockResolvedValueOnce(
      row({ warnings }) as never
    );

    const result = await getAssetImportDetails(args);

    expect(result.warnings).toEqual(warnings);
    expect(
      vi.mocked(db.assetImport.findFirst).mock.calls[0][0]?.select
    ).toMatchObject({ warnings: true });
  });

  it("returns no warnings when none are stored", async () => {
    vi.mocked(db.assetImport.findFirst).mockResolvedValueOnce(
      row({ warnings: null }) as never
    );

    const result = await getAssetImportDetails(args);

    expect(result.warnings).toEqual([]);
  });

  it("404s details for an import that is not visible", async () => {
    vi.mocked(db.assetImport.findFirst).mockResolvedValueOnce(null);

    await expect(getAssetImportDetails(args)).rejects.toMatchObject({
      status: 404,
    });
  });
});

describe("getActiveAssetImport", () => {
  /** A selected import row; override what a test cares about. */
  function row(overrides: Record<string, unknown> = {}) {
    return {
      id: "imp",
      organizationId: "org",
      createdById: "other",
      status: "RUNNING",
      phase: "ROWS",
      fileName: "assets.csv",
      totalRows: 10,
      processedRows: 3,
      errorMessage: null,
      warningCount: 0,
      completedAt: null,
      updatedAt: new Date(),
      ...overrides,
    };
  }

  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("returns a running import started by someone else as not mine", async () => {
    vi.mocked(db.assetImport.findFirst).mockResolvedValueOnce(row() as never);

    const result = await getActiveAssetImport({
      userId: "u",
      organizationId: "org",
    });

    expect(result).toMatchObject({
      id: "imp",
      status: "RUNNING",
      isMine: false,
    });
  });

  it("marks the viewer's own import as mine", async () => {
    vi.mocked(db.assetImport.findFirst).mockResolvedValueOnce(
      row({ createdById: "u" }) as never
    );

    const result = await getActiveAssetImport({
      userId: "u",
      organizationId: "org",
    });

    expect(result?.isMine).toBe(true);
  });

  it("returns null when nothing qualifies", async () => {
    vi.mocked(db.assetImport.findFirst).mockResolvedValueOnce(null);

    await expect(
      getActiveAssetImport({ userId: "u", organizationId: "org" })
    ).resolves.toBeNull();
  });

  it("prefers a live import over the viewer's recently finished one", async () => {
    vi.mocked(db.assetImport.findFirst).mockResolvedValueOnce(row() as never);

    const result = await getActiveAssetImport({
      userId: "u",
      organizationId: "org",
    });

    expect(result?.status).toBe("RUNNING");
    expect(db.assetImport.findFirst).toHaveBeenCalledTimes(1);
    const query = vi.mocked(db.assetImport.findFirst).mock.calls[0][0];
    expect(query?.where).toEqual({
      organizationId: "org",
      status: { in: ["QUEUED", "RUNNING"] },
    });
  });

  it("limits finished imports to the viewer's own from the last 10 minutes", async () => {
    vi.mocked(db.assetImport.findFirst)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);

    await getActiveAssetImport({ userId: "u", organizationId: "org" });

    const query = vi.mocked(db.assetImport.findFirst).mock.calls[1][0];
    const where = query?.where as Record<string, unknown>;
    expect(where).toMatchObject({
      organizationId: "org",
      status: { in: ["COMPLETED", "FAILED"] },
      createdById: "u",
    });
    const { gt } = where.updatedAt as { gt: Date };
    const ageMinutes = (Date.now() - gt.getTime()) / 60000;
    expect(ageMinutes).toBeGreaterThan(9.9);
    expect(ageMinutes).toBeLessThan(10.1);
    expect(query?.orderBy).toEqual({ updatedAt: "desc" });
  });

  it("fails a stalled RUNNING import and reports it as FAILED", async () => {
    vi.mocked(db.assetImport.findFirst)
      .mockResolvedValueOnce(row({ updatedAt: minutesAgo(120) }) as never)
      .mockResolvedValueOnce(
        imp({
          status: "FAILED",
          phase: "ROWS",
          errorMessage: "stopped",
          completedAt: null,
          processedRows: 4,
          warningCount: 0,
        }) as never
      );
    vi.mocked(db.assetImport.updateMany).mockResolvedValue({ count: 1 });

    const result = await getActiveAssetImport({
      userId: "u",
      organizationId: "org",
    });

    expect(db.assetImport.updateMany).toHaveBeenCalled();
    expect(result?.status).toBe("FAILED");
  });

  it("never selects rows, resolved data or warnings", async () => {
    vi.mocked(db.assetImport.findFirst).mockResolvedValueOnce(null);

    await getActiveAssetImport({ userId: "u", organizationId: "org" });

    const query = vi.mocked(db.assetImport.findFirst).mock.calls[0][0];
    expect(query?.select).not.toHaveProperty("rows");
    expect(query?.select).not.toHaveProperty("resolved");
    expect(query?.select).not.toHaveProperty("warnings");
  });
});
