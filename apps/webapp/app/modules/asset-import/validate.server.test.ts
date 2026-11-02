// @vitest-environment node
/**
 * Tests for `validateContentImportFile`: how row and code problems are combined
 * into one error, and the ordering of the checks that follow.
 *
 * @see {@link file://./validate.server.ts}
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { db } from "~/database/db.server";
import { validateKitCustodyConflicts } from "~/modules/asset/service.server";
import { MAX_REPORTED_ROW_ERRORS } from "~/utils/import-row-errors";
import { collectImportCodeProblems } from "./code-problems.server";
import { MAX_BACKGROUND_IMPORT_ROWS } from "./constants";
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

// why: the code checks read the database and have their own tests; here only
// how their errors are merged matters.
vi.mock("./code-problems.server", () => ({
  collectImportCodeProblems: vi.fn(),
}));

const customFieldFindMany = vi.mocked(db.customField.findMany);
const codeProblems = vi.mocked(collectImportCodeProblems);

const args = { organizationId: "org", userId: "u" };

/** Runs the validation and returns the ShelfError it throws. */
async function rejection(
  promise: Promise<void>
): Promise<{ status?: number; additionalData?: Record<string, unknown> }> {
  try {
    await promise;
  } catch (error) {
    return error as {
      status?: number;
      additionalData?: Record<string, unknown>;
    };
  }
  throw new Error("expected validateContentImportFile to throw");
}

describe("validateContentImportFile", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    customFieldFindMany.mockResolvedValue([]);
    codeProblems.mockResolvedValue([]);
  });

  it("throws the row-error ShelfError when preflight finds problems", async () => {
    const bad = [{ key: "k", title: "A", description: "a".repeat(5123) }];
    await expect(
      validateContentImportFile({
        ...args,
        data: bad as never,
        canUseBarcodes: false,
      })
    ).rejects.toMatchObject({ status: 400, title: "Import file has errors" });
    expect(validateKitCustodyConflicts).not.toHaveBeenCalled();
  });

  it("reports row and code problems together, ordered by row", async () => {
    codeProblems.mockResolvedValue([
      { row: 2, title: "QR code not found", message: "qr" },
    ]);
    const rows = [
      { key: "a", title: "A", qrId: "missing" },
      { key: "b", title: "" },
    ];

    const error = await rejection(
      validateContentImportFile({
        ...args,
        data: rows as never,
        canUseBarcodes: true,
      })
    );

    expect(error.status).toBe(400);
    expect(error.additionalData?.totalErrors).toBe(2);
    expect(error.additionalData?.rowErrors).toEqual([
      { row: 2, title: "QR code not found", message: "qr" },
      expect.objectContaining({ row: 3, title: "Title required" }),
    ]);
    expect(codeProblems).toHaveBeenCalledWith({
      data: rows,
      organizationId: "org",
      canUseBarcodes: true,
    });
  });

  it("counts every problem but lists only the first ones", async () => {
    codeProblems.mockResolvedValue(
      Array.from({ length: MAX_REPORTED_ROW_ERRORS }, (_, index) => ({
        row: index + 2,
        title: "Duplicate barcode",
        message: "dup",
      }))
    );

    const error = await rejection(
      validateContentImportFile({
        ...args,
        data: [{ key: "a", title: "" }] as never,
        canUseBarcodes: true,
      })
    );

    expect(error.additionalData?.totalErrors).toBe(MAX_REPORTED_ROW_ERRORS + 1);
    expect(error.additionalData?.rowErrors).toHaveLength(
      MAX_REPORTED_ROW_ERRORS
    );
  });

  it("skips the code lookups for a file over the row cap", async () => {
    const data = Array.from({ length: MAX_BACKGROUND_IMPORT_ROWS + 1 }, () => ({
      key: "k",
      title: "A",
    }));

    await expect(
      validateContentImportFile({
        ...args,
        data: data as never,
        canUseBarcodes: true,
      })
    ).rejects.toMatchObject({ status: 400 });
    expect(codeProblems).not.toHaveBeenCalled();
  });

  it("refuses barcode columns when the workspace has no barcode add-on", async () => {
    const rows = [{ key: "k", title: "A", barcode_Code128: "ABC123" }];
    await expect(
      validateContentImportFile({
        ...args,
        data: rows as never,
        canUseBarcodes: false,
      })
    ).rejects.toMatchObject({ status: 403 });
    expect(validateKitCustodyConflicts).not.toHaveBeenCalled();
  });

  it("runs the code and kit custody checks on a clean file", async () => {
    await validateContentImportFile({
      ...args,
      data: [{ key: "k", title: "A" }] as never,
      canUseBarcodes: false,
    });
    expect(codeProblems).toHaveBeenCalledWith(
      expect.objectContaining({ canUseBarcodes: false })
    );
    expect(validateKitCustodyConflicts).toHaveBeenCalledOnce();
  });
});
