// @vitest-environment node
/**
 * Tests for `recordScan` and its non-fatal wrappers: which columns each code
 * type writes, the 30-second fold of a repeated scan, the audit relabel, and
 * the note on the scanned asset (its wording, its org, and when there is none).
 *
 * @see {@link file://./service.server.ts}
 */
import Markdoc from "@markdoc/markdoc";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  scanFindFirst: vi.fn(),
  scanCreate: vi.fn(),
  scanUpdate: vi.fn(),
  executeRaw: vi.fn(),
  userOrgCount: vi.fn(),
  qrFindFirst: vi.fn(),
  barcodeFindFirst: vi.fn(),
  createNote: vi.fn(),
  getUserByID: vi.fn(),
  getOrganizationById: vi.fn(),
  loggerError: vi.fn(),
}));

// why: the database is the external boundary; every query the helper makes is
// asserted through these. The transaction runs its callback against the same
// client, as Prisma's interactive transaction does.
vi.mock("~/database/db.server", () => {
  const db = {
    scan: {
      findFirst: mocks.scanFindFirst,
      create: mocks.scanCreate,
      update: mocks.scanUpdate,
    },
    $executeRaw: mocks.executeRaw,
    userOrganization: { count: mocks.userOrgCount },
    qr: { findFirst: mocks.qrFindFirst },
    barcode: { findFirst: mocks.barcodeFindFirst },
    $transaction: (callback: (tx: unknown) => unknown) => callback(db),
  };
  return { db };
});

// why: createNote writes to the database and runs its own org guard, which
// has its own tests; here we assert what the scan asks it to write.
vi.mock("~/modules/note/service.server", () => ({
  createNote: mocks.createNote,
}));

// why: both read the database; the note only needs the returned name / owner.
vi.mock("~/modules/user/service.server", () => ({
  getUserByID: mocks.getUserByID,
}));
vi.mock("~/modules/organization/service.server", () => ({
  getOrganizationById: mocks.getOrganizationById,
}));

// why: the real logger ships to Sentry; the non-fatal wrappers must log.
vi.mock("~/utils/logger", () => ({ Logger: { error: mocks.loggerError } }));

import {
  recordAuditScanNonFatal,
  recordScan,
  recordScanNonFatal,
  SCAN_DEDUPE_WINDOW_MS,
} from "./service.server";
import type { RecordScanArgs } from "./service.server";

/** A barcode scan from a drawer by a signed-in member; override per case. */
function scanArgs(overrides: Partial<RecordScanArgs> = {}): RecordScanArgs {
  return {
    codeType: "BARCODE",
    code: "BC-0042",
    source: "WEB_DRAWER",
    userId: "user-1",
    userAgent: "Mozilla/5.0",
    organizationId: "org-1",
    assetId: "asset-1",
    barcodeId: "barcode-1",
    writeNote: false,
    ...overrides,
  };
}

/** The `data` of the single `db.scan.create` call. */
function createdData() {
  expect(mocks.scanCreate).toHaveBeenCalledTimes(1);
  return mocks.scanCreate.mock.calls[0][0].data;
}

/** The content of the single note written. */
function noteContent(): string {
  expect(mocks.createNote).toHaveBeenCalledTimes(1);
  return mocks.createNote.mock.calls[0][0].content;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.scanFindFirst.mockResolvedValue(null);
  mocks.scanCreate.mockImplementation(({ data }) =>
    Promise.resolve({ id: "scan-new", ...data })
  );
  mocks.scanUpdate.mockImplementation(({ where, data }) =>
    Promise.resolve({ id: where.id, ...data })
  );
  mocks.userOrgCount.mockResolvedValue(1);
  mocks.getUserByID.mockResolvedValue({
    firstName: "Dana",
    lastName: "Reeves",
    displayName: "Dana Reeves",
  });
  mocks.getOrganizationById.mockResolvedValue({ userId: "owner-1" });
  mocks.createNote.mockResolvedValue({ id: "note-1" });
  mocks.qrFindFirst.mockResolvedValue(null);
  mocks.barcodeFindFirst.mockResolvedValue(null);
});

describe("recordScan: what each code type writes", () => {
  it("stamps a barcode scan with its barcode, entity and org, and no QR", async () => {
    await recordScan(scanArgs());

    expect(createdData()).toMatchObject({
      codeType: "BARCODE",
      code: "BC-0042",
      source: "WEB_DRAWER",
      userId: "user-1",
      barcodeId: "barcode-1",
      qrId: null,
      rawQrId: null,
      assetId: "asset-1",
      kitId: null,
      organizationId: "org-1",
    });
  });

  it("keeps the raw QR id on a QR scan, so it outlives the QR", async () => {
    await recordScan(
      scanArgs({
        codeType: "QR",
        code: "qr-1",
        qrId: "qr-1",
        barcodeId: "ignored",
        source: "COMPANION",
      })
    );

    expect(createdData()).toMatchObject({
      codeType: "QR",
      qrId: "qr-1",
      rawQrId: "qr-1",
      barcodeId: null,
    });
  });

  it("writes a SAM ID scan with neither a QR nor a barcode", async () => {
    await recordScan(
      scanArgs({ codeType: "SAM_ID", code: "SAM-0007", barcodeId: undefined })
    );

    expect(createdData()).toMatchObject({
      codeType: "SAM_ID",
      code: "SAM-0007",
      qrId: null,
      rawQrId: null,
      barcodeId: null,
    });
  });

  it("stores no user for an anonymous public QR hit", async () => {
    await recordScan(
      scanArgs({
        codeType: "QR",
        code: "qr-1",
        qrId: "qr-1",
        source: "QR_LINK",
        userId: "anonymous",
      })
    );

    expect(createdData().userId).toBeNull();
  });
});

describe("recordScan: repeated scans", () => {
  it("looks for the same user, code and entity inside the window", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-29T12:00:30.000Z"));

    await recordScan(scanArgs());

    expect(mocks.scanFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          userId: "user-1",
          code: "BC-0042",
          assetId: "asset-1",
          kitId: null,
          createdAt: {
            gte: new Date(Date.now() - SCAN_DEDUPE_WINDOW_MS),
          },
        },
      })
    );
    expect(SCAN_DEDUPE_WINDOW_MS).toBe(30_000);
    vi.useRealTimers();
  });

  it("takes one lock per user, code and entity before looking", async () => {
    // Concurrent requests for one scan must run one after the other, or both
    // miss each other's row and insert twice.
    await recordScan(scanArgs());

    expect(mocks.executeRaw).toHaveBeenCalledTimes(1);
    const [sql, lockKey] = mocks.executeRaw.mock.calls[0];
    expect(sql.join("?")).toContain("pg_advisory_xact_lock(hashtext(?))");
    expect(lockKey).toBe("scan:user-1:BC-0042:asset-1:");
    expect(mocks.executeRaw.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.scanFindFirst.mock.invocationCallOrder[0]
    );
  });

  it("folds a repeat into the recent row: no insert, no second note", async () => {
    const recent = { id: "scan-recent", source: "WEB_SCANNER" };
    mocks.scanFindFirst.mockResolvedValue(recent);

    const result = await recordScan(
      scanArgs({ source: "WEB_SCANNER", writeNote: true })
    );

    expect(result).toBe(recent);
    expect(mocks.scanCreate).not.toHaveBeenCalled();
    expect(mocks.scanUpdate).not.toHaveBeenCalled();
    expect(mocks.createNote).not.toHaveBeenCalled();
  });

  it("relabels the resolve's recent row as an audit scan instead of adding one", async () => {
    mocks.scanFindFirst.mockResolvedValue({
      id: "scan-recent",
      source: "COMPANION",
    });

    const result = await recordScan(scanArgs({ source: "AUDIT" }));

    expect(mocks.scanUpdate).toHaveBeenCalledWith({
      where: { id: "scan-recent" },
      data: { source: "AUDIT" },
    });
    expect(result.source).toBe("AUDIT");
    expect(mocks.scanCreate).not.toHaveBeenCalled();
  });

  it("leaves a recent audit row as it is", async () => {
    mocks.scanFindFirst.mockResolvedValue({ id: "scan-a", source: "AUDIT" });

    await recordScan(scanArgs({ source: "AUDIT" }));

    expect(mocks.scanUpdate).not.toHaveBeenCalled();
    expect(mocks.scanCreate).not.toHaveBeenCalled();
  });

  it.each(["QR_LINK", "GPS_UPDATE"] as const)(
    "always inserts for %s",
    async (source) => {
      mocks.scanFindFirst.mockResolvedValue({ id: "scan-recent" });

      await recordScan(
        scanArgs({ codeType: "QR", code: "qr-1", qrId: "qr-1", source })
      );

      expect(mocks.scanFindFirst).not.toHaveBeenCalled();
      expect(mocks.scanCreate).toHaveBeenCalledTimes(1);
    }
  );

  it("never folds anonymous scans: there is no user to match", async () => {
    await recordScan(scanArgs({ userId: null, source: "WEB_DRAWER" }));

    expect(mocks.scanFindFirst).not.toHaveBeenCalled();
    expect(mocks.scanCreate).toHaveBeenCalledTimes(1);
  });
});

describe("recordScan: the note on the asset", () => {
  it("names the barcode a member scanned, in the code's org", async () => {
    await recordScan(scanArgs({ source: "WEB_SCANNER", writeNote: true }));

    expect(noteContent()).toContain(
      "performed a scan of the asset barcode **BC-0042**."
    );
    expect(mocks.createNote).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "UPDATE",
        userId: "user-1",
        assetId: "asset-1",
        organizationId: "org-1",
      })
    );
  });

  it("names the SAM ID", async () => {
    await recordScan(
      scanArgs({ codeType: "SAM_ID", code: "SAM-0007", writeNote: true })
    );

    expect(noteContent()).toContain(
      "performed a scan of the asset SAM ID **SAM-0007**."
    );
  });

  it("keeps the QR wording", async () => {
    await recordScan(
      scanArgs({ codeType: "QR", code: "qr-1", qrId: "qr-1", writeNote: true })
    );

    expect(noteContent()).toContain("performed a scan of the asset QR code.");
  });

  it("writes an unknown user, as the org owner, for a non-member", async () => {
    mocks.userOrgCount.mockResolvedValue(0);

    await recordScan(scanArgs({ writeNote: true }));

    expect(mocks.userOrgCount).toHaveBeenCalledWith({
      where: { userId: "user-1", organizationId: "org-1" },
    });
    expect(noteContent()).toBe(
      "An unknown user has performed a scan of the asset barcode **BC-0042**."
    );
    expect(mocks.createNote).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "owner-1", organizationId: "org-1" })
    );
  });

  it("strips Markdoc tags from the scanned value", async () => {
    // A non-member's note carries no actor link, so any tag left in it can
    // only have come from the scanned value.
    mocks.userOrgCount.mockResolvedValue(0);

    await recordScan(
      scanArgs({
        code: '{% link to="javascript:alert(1)" text="x" /%}',
        writeNote: true,
      })
    );

    const tags = [...Markdoc.parse(noteContent()).walk()].filter(
      (node) => node.type === "tag"
    );
    expect(tags).toEqual([]);
  });

  it("writes no note when the caller asks for none", async () => {
    await recordScan(scanArgs({ writeNote: false }));

    expect(mocks.createNote).not.toHaveBeenCalled();
  });

  it("writes no note for a kit scan", async () => {
    await recordScan(
      scanArgs({ assetId: null, kitId: "kit-1", writeNote: true })
    );

    expect(createdData().kitId).toBe("kit-1");
    expect(mocks.createNote).not.toHaveBeenCalled();
  });

  it("cannot be called without the workspace the code resolved in", () => {
    // A scan with no workspace (an unclaimed QR) is never recorded: nobody
    // could read it. The type is the guard, so this pins it at compile time.
    const args: RecordScanArgs = {
      ...scanArgs(),
      // @ts-expect-error organizationId is required and never null
      organizationId: null,
    };
    expect(args.organizationId).toBeNull();
  });
});

describe("recordScanNonFatal", () => {
  it("logs and swallows a failed write", async () => {
    mocks.scanCreate.mockRejectedValue(new Error("db down"));

    await expect(recordScanNonFatal(scanArgs())).resolves.toBeNull();
    expect(mocks.loggerError).toHaveBeenCalledTimes(1);
  });

  it("logs and swallows a failed note", async () => {
    mocks.createNote.mockRejectedValue(new Error("note failed"));

    await expect(
      recordScanNonFatal(scanArgs({ writeNote: true }))
    ).resolves.toBeNull();
    expect(mocks.loggerError).toHaveBeenCalledTimes(1);
  });
});

describe("recordAuditScanNonFatal", () => {
  const asset = { id: "asset-1", sequentialId: "SAM-0007" };
  const base = { asset, organizationId: "org-1", userId: "user-1" };

  it("records the asset's SAM ID as an audit scan, with no note", async () => {
    await recordAuditScanNonFatal({ ...base, code: "sam-0007" });

    expect(createdData()).toMatchObject({
      codeType: "SAM_ID",
      code: "sam-0007",
      source: "AUDIT",
      assetId: "asset-1",
      organizationId: "org-1",
    });
    expect(mocks.createNote).not.toHaveBeenCalled();
  });

  it("records one of the asset's QR codes", async () => {
    mocks.qrFindFirst.mockResolvedValue({ id: "qr-1" });

    await recordAuditScanNonFatal({ ...base, code: "qr-1" });

    expect(mocks.qrFindFirst).toHaveBeenCalledWith({
      where: { id: "qr-1", assetId: "asset-1", organizationId: "org-1" },
      select: { id: true },
    });
    expect(createdData()).toMatchObject({ codeType: "QR", qrId: "qr-1" });
  });

  it("records one of the asset's barcodes", async () => {
    mocks.barcodeFindFirst.mockResolvedValue({ id: "barcode-1" });

    await recordAuditScanNonFatal({ ...base, code: "bc-0042" });

    expect(mocks.barcodeFindFirst).toHaveBeenCalledWith({
      where: {
        OR: [{ value: "bc-0042" }, { value: "BC-0042" }],
        assetId: "asset-1",
        organizationId: "org-1",
      },
      select: { id: true },
    });
    expect(createdData()).toMatchObject({
      codeType: "BARCODE",
      barcodeId: "barcode-1",
    });
  });

  it("records nothing for a value that is none of the asset's codes", async () => {
    await expect(
      recordAuditScanNonFatal({ ...base, code: "stranger" })
    ).resolves.toBeNull();

    expect(mocks.scanCreate).not.toHaveBeenCalled();
  });

  it("swallows a failure", async () => {
    mocks.qrFindFirst.mockRejectedValue(new Error("db down"));

    await expect(
      recordAuditScanNonFatal({ ...base, code: "qr-1" })
    ).resolves.toBeNull();
    expect(mocks.loggerError).toHaveBeenCalledTimes(1);
  });
});
