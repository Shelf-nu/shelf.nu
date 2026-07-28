import { describe, expect, it, vitest, beforeEach } from "vitest";
import { db } from "~/database/db.server";
import { ShelfError } from "~/utils/error";
import { claimQrCode, parseQrCodesFromImportData } from "./service.server";

// why: parseQrCodesFromImportData reads QR rows from the database to detect
// invalid imports, and claimQrCode reads (findUniqueOrThrow via getQr) then
// atomically updates a single row; mock the client so the tests exercise the
// validation/claim branches without a real DB.
vitest.mock("~/database/db.server", () => ({
  db: {
    qr: {
      findMany: vitest.fn().mockResolvedValue([]),
      updateMany: vitest.fn().mockResolvedValue({ count: 0 }),
      findUniqueOrThrow: vitest.fn(),
      update: vitest.fn(),
    },
  },
}));

const userId = "user-1";
const organizationId = "org-1";

/**
 * Runs parseQrCodesFromImportData and returns the thrown ShelfError, failing
 * the test if it unexpectedly resolves.
 */
async function captureThrow(
  data: Parameters<typeof parseQrCodesFromImportData>[0]["data"]
) {
  try {
    await parseQrCodesFromImportData({ data, userId, organizationId });
    throw new Error("expected parseQrCodesFromImportData to throw");
  } catch (err) {
    expect(err).toBeInstanceOf(ShelfError);
    return err as ShelfError;
  }
}

describe("parseQrCodesFromImportData — import validation errors", () => {
  beforeEach(() => {
    vitest.clearAllMocks();
    (db.qr.findMany as ReturnType<typeof vitest.fn>).mockResolvedValue([]);
  });

  it("rejects duplicate QR codes with a 400 and does not capture", async () => {
    const data = [
      { key: "a", title: "A", qrId: "qr-1" },
      { key: "b", title: "B", qrId: "qr-1" },
    ] as Parameters<typeof parseQrCodesFromImportData>[0]["data"];

    const err = await captureThrow(data);

    expect(err.status).toBe(400);
    expect(err.shouldBeCaptured).toBe(false);
  });

  it("rejects non-existent QR codes with a 400 and does not capture", async () => {
    // No matching rows returned → the code is treated as non-existent.
    const data = [{ key: "a", title: "A", qrId: "missing" }] as Parameters<
      typeof parseQrCodesFromImportData
    >[0]["data"];

    const err = await captureThrow(data);

    expect(err.status).toBe(400);
    expect(err.shouldBeCaptured).toBe(false);
  });

  it("rejects codes already linked to an asset/kit with a 400 and does not capture", async () => {
    (db.qr.findMany as ReturnType<typeof vitest.fn>).mockResolvedValue([
      { id: "qr-1", assetId: "asset-1", kitId: null, organizationId },
    ]);
    const data = [{ key: "a", title: "A", qrId: "qr-1" }] as Parameters<
      typeof parseQrCodesFromImportData
    >[0]["data"];

    const err = await captureThrow(data);

    expect(err.status).toBe(400);
    expect(err.shouldBeCaptured).toBe(false);
  });

  it("rejects codes belonging to another organization with a 400 and does not capture", async () => {
    (db.qr.findMany as ReturnType<typeof vitest.fn>).mockResolvedValue([
      { id: "qr-1", assetId: null, kitId: null, organizationId: "other-org" },
    ]);
    const data = [{ key: "a", title: "A", qrId: "qr-1" }] as Parameters<
      typeof parseQrCodesFromImportData
    >[0]["data"];

    const err = await captureThrow(data);

    expect(err.status).toBe(400);
    expect(err.shouldBeCaptured).toBe(false);
  });
});

describe("claimQrCode", () => {
  const claimArgs = { id: "qr-1", organizationId, userId };

  /** An unclaimed, unlinked QR row as returned by the pre-check read. */
  const unclaimedQr = {
    id: "qr-1",
    organizationId: null,
    userId: null,
    assetId: null,
    kitId: null,
  };

  beforeEach(() => {
    vitest.clearAllMocks();
  });

  /**
   * Runs claimQrCode and returns the thrown ShelfError, failing the test if
   * it unexpectedly resolves.
   */
  async function captureClaimThrow() {
    try {
      await claimQrCode(claimArgs);
      throw new Error("expected claimQrCode to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(ShelfError);
      return err as ShelfError;
    }
  }

  it("rejects an already-claimed code with a 403 without writing", async () => {
    // why: the pre-check read must see a row that already belongs to an org
    // to exercise the early "already claimed" branch.
    (db.qr.findUniqueOrThrow as ReturnType<typeof vitest.fn>).mockResolvedValue(
      { ...unclaimedQr, organizationId: "other-org" }
    );

    const err = await captureClaimThrow();

    expect(err.status).toBe(403);
    expect(err.message).toBe(
      "This QR code already belongs to an organization so you cannot claim it."
    );
    expect(db.qr.update).not.toHaveBeenCalled();
  });

  it("maps a lost claim race (P2025 on the atomic update) to a 403, not a 404", async () => {
    // why: the pre-check must pass (unclaimed row) so the test drives the
    // window AFTER the guard — a concurrent claim/link wins the atomic
    // update and Prisma raises P2025 for the loser.
    (db.qr.findUniqueOrThrow as ReturnType<typeof vitest.fn>).mockResolvedValue(
      unclaimedQr
    );
    // why: simulate the losing side of the race; Prisma signals "no row
    // matched the constrained WHERE" as a P2025 known request error.
    (db.qr.update as ReturnType<typeof vitest.fn>).mockRejectedValue({
      code: "P2025",
    });

    const err = await captureClaimThrow();

    // The lost race must surface as "already claimed" (403), never as a
    // not-found (404) — makeShelfError would collapse a propagated P2025
    // to a 404 if the mapping branch were removed.
    expect(err.status).toBe(403);
    expect(err.message).toBe(
      "This QR code has already been claimed or linked so you cannot claim it."
    );
  });

  it("claims atomically: the update WHERE requires the unclaimed AND unlinked state", async () => {
    (db.qr.findUniqueOrThrow as ReturnType<typeof vitest.fn>).mockResolvedValue(
      unclaimedQr
    );
    const claimedQr = { ...unclaimedQr, organizationId, userId };
    // why: resolve the write so the success branch returns the claimed row.
    (db.qr.update as ReturnType<typeof vitest.fn>).mockResolvedValue(claimedQr);

    const result = await claimQrCode(claimArgs);

    expect(result).toEqual(claimedQr);
    // Guard the atomicity constraint itself: dropping any of these WHERE
    // conditions would let a lost race silently re-assign the code's org
    // (or claim a code createAsset just linked to another org's asset).
    expect(db.qr.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: "qr-1",
          organizationId: null,
          assetId: null,
          kitId: null,
        },
        data: { organizationId, userId },
      })
    );
  });
});
