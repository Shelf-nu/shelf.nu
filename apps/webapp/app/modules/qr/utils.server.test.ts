/**
 * Tests for {@link generateQrObj} (`~/modules/qr/utils.server`).
 *
 * The function answers "give me this asset's or kit's QR", creating one when
 * there isn't any — kits created by a content import have none until something
 * asks. That makes it a check-then-create, and the schema cannot stop a second
 * one being made: `Qr.assetId` and `Qr.kitId` are nullable and non-unique,
 * because an unclaimed code has neither and a code can be relinked. So the
 * serialisation has to come from the write path, which is what these cases pin.
 *
 * Two codes for one kit is not a visible failure — each renders a valid label
 * at a different URL, and scans split silently between them.
 *
 * @see {@link file://./utils.server.ts}
 */
import { describe, expect, it, vi, beforeEach } from "vitest";

const qrRow = {
  id: "qr-1",
  version: 0,
  errorCorrection: "L",
  assetId: null,
  kitId: "kit-1",
  userId: "user-1",
  organizationId: "org-1",
};

// why: the lookup outside the transaction and the create inside it are the two
// halves under test; stubbing them is how each case states what the database
// held at each moment.
const serviceMocks = vi.hoisted(() => ({
  getQrByKitId: vi.fn(),
  getQrByAssetId: vi.fn(),
  createQr: vi.fn(),
}));

vi.mock("./service.server", () => serviceMocks);

// why: `generateQrObj` locks the owning row and re-reads inside a transaction;
// the stub runs that body against the same delegates the assertions read.
vi.mock("~/database/db.server", () => ({
  db: {
    qr: { findFirst: vi.fn() },
    $queryRaw: vi.fn().mockResolvedValue([{ id: "kit-1" }]),
    $transaction: vi.fn(),
  },
}));

import { db } from "~/database/db.server";
import { generateQrObj } from "./utils.server";

describe("generateQrObj", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (db.$queryRaw as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: "kit-1" },
    ]);
    (db.$transaction as ReturnType<typeof vi.fn>).mockImplementation(
      (callback: (tx: typeof db) => unknown) => callback(db)
    );
    serviceMocks.createQr.mockResolvedValue(qrRow);
  });

  it("returns the existing code without creating another", async () => {
    serviceMocks.getQrByKitId.mockResolvedValue(qrRow);

    const result = await generateQrObj({
      kitId: "kit-1",
      userId: "user-1",
      organizationId: "org-1",
    });

    expect(result.qr).toBeTruthy();
    expect(serviceMocks.createQr).not.toHaveBeenCalled();
  });

  it("creates one under a lock on the owning row when there is none", async () => {
    serviceMocks.getQrByKitId.mockResolvedValue(null);
    (db.qr.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    await generateQrObj({
      kitId: "kit-1",
      userId: "user-1",
      organizationId: "org-1",
    });

    // The lock is what makes the re-read below meaningful: without it two
    // callers both read "no code" and both create one.
    expect(db.$queryRaw).toHaveBeenCalled();
    const lockSql = (db.$queryRaw as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(String(lockSql)).toMatch(/FOR UPDATE/i);
    expect(serviceMocks.createQr).toHaveBeenCalled();
  });

  it("uses the code a concurrent caller created instead of making a second", async () => {
    // Nothing existed when the first read ran, but by the time this caller
    // holds the lock another has committed one.
    serviceMocks.getQrByKitId.mockResolvedValue(null);
    (db.qr.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({
      ...qrRow,
      id: "qr-from-the-winner",
    });

    const result = await generateQrObj({
      kitId: "kit-1",
      userId: "user-1",
      organizationId: "org-1",
    });

    expect(result.qr).toBeTruthy();
    expect(serviceMocks.createQr).not.toHaveBeenCalled();
  });
});
