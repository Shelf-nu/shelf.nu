import { describe, expect, it, vitest, beforeEach } from "vitest";
import { db } from "~/database/db.server";
import { ShelfError } from "~/utils/error";
import { parseQrCodesFromImportData } from "./service.server";

// why: parseQrCodesFromImportData reads QR rows from the database to detect
// invalid imports; mock the client so the tests exercise the validation
// branches without a real DB.
vitest.mock("~/database/db.server", () => ({
  db: {
    qr: {
      findMany: vitest.fn().mockResolvedValue([]),
      updateMany: vitest.fn().mockResolvedValue({ count: 0 }),
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
