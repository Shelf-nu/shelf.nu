// @vitest-environment node
/**
 * Tests for `validateContentImportFile`: ordering of the read-only checks and
 * the errors they raise.
 *
 * @see {@link file://./validate.server.ts}
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { db } from "~/database/db.server";
import { validateKitCustodyConflicts } from "~/modules/asset/service.server";
import { parseBarcodesFromImportData } from "~/modules/barcode/service.server";
import type * as BarcodeService from "~/modules/barcode/service.server";
import { validateImportQrCodes } from "~/modules/qr/service.server";
import { validateContentImportFile } from "./validate.server";

// why: the only DB read the row checks need is the workspace's custom fields.
vi.mock("~/database/db.server", () => ({
  db: { customField: { findMany: vi.fn() } },
}));

// why: the asset service is a huge module with its own tests; only the kit
// custody check is used here and it hits the database.
vi.mock("~/modules/asset/service.server", () => ({
  validateKitCustodyConflicts: vi.fn(),
}));

// why: the QR check reads the database and has its own tests; here only its
// ordering matters.
vi.mock("~/modules/qr/service.server", () => ({
  validateImportQrCodes: vi.fn(),
}));

// why: barcode parsing reads the database and has its own tests. The pure
// `importDataHasBarcodes` stays real.
vi.mock("~/modules/barcode/service.server", async (importActual) => ({
  ...(await importActual<typeof BarcodeService>()),
  parseBarcodesFromImportData: vi.fn(),
}));

const customFieldFindMany = vi.mocked(db.customField.findMany);

describe("validateContentImportFile", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    customFieldFindMany.mockResolvedValue([]);
  });

  it("throws the row-error ShelfError when preflight finds problems", async () => {
    const bad = [{ key: "k", title: "A", description: "a".repeat(5123) }];
    await expect(
      validateContentImportFile({
        data: bad as never,
        organizationId: "org",
        userId: "u",
        canUseBarcodes: false,
      })
    ).rejects.toMatchObject({ status: 400, title: "Import file has errors" });
    expect(validateImportQrCodes).not.toHaveBeenCalled();
  });

  it("refuses barcode columns when the workspace has no barcode add-on", async () => {
    const rows = [{ key: "k", title: "A", barcode_Code128: "ABC123" }];
    await expect(
      validateContentImportFile({
        data: rows as never,
        organizationId: "org",
        userId: "u",
        canUseBarcodes: false,
      })
    ).rejects.toMatchObject({ status: 403 });
    expect(validateKitCustodyConflicts).not.toHaveBeenCalled();
  });

  it("runs QR, barcode and kit custody checks on a clean file", async () => {
    const rows = [{ key: "k", title: "A" }];
    await validateContentImportFile({
      data: rows as never,
      organizationId: "org",
      userId: "u",
      canUseBarcodes: true,
    });
    expect(validateImportQrCodes).toHaveBeenCalledOnce();
    expect(parseBarcodesFromImportData).toHaveBeenCalledOnce();
    expect(validateKitCustodyConflicts).toHaveBeenCalledOnce();
  });

  it("skips barcode parsing when the add-on is off and the file has none", async () => {
    await validateContentImportFile({
      data: [{ key: "k", title: "A" }] as never,
      organizationId: "org",
      userId: "u",
      canUseBarcodes: false,
    });
    expect(parseBarcodesFromImportData).not.toHaveBeenCalled();
  });
});
